"use client";
import { useState, useEffect, useRef } from "react";
import { useWallet, useConnection, useAnchorWallet } from "@solana/wallet-adapter-react";
import dynamic from "next/dynamic";
const WalletMultiButton = dynamic(
  async () => (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false }
);
import { PublicKey, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import Link from "next/link";
import { 
    checkCompanyRegistration, 
    fetchCompanyData, 
    addEmployeeTransaction, 
    updateEmployeeTransaction,
    removeEmployeeTransaction,
    payEmployeeTransaction,
    BotWallet
} from "../lib/solana";
import { encryptSalary, decryptSalary, decryptSalaries } from "../lib/inco";
import { payEmployee, fetchPaymentHistory, PaymentRecord, clearPaymentHistory } from "../lib/payment";
import { fetchAllEmployees, EmployeeData } from "../lib/fetchEmployee";
import { useRouter } from "next/navigation";
import { useRpc } from "../providers";

interface Employee {
  id: string;
  name: string;
  role: string;
  address: string;
  salary: string;
  lastPaid: string | null;
  pin: string;
  nextPaymentDate: number;
  schedule: string;
  encryptedSalary: number[];
  inputType: number;
}

export default function EmployerDashboard() {
  const router = useRouter();
  const { connection } = useConnection();
  const { switchEndpoint } = useRpc();
  const walletContext = useWallet();
  const { publicKey, wallet } = walletContext;
  const anchorWallet = useAnchorWallet();

  // Employee State
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [employeeName, setEmployeeName] = useState("");
  const [employeeAddress, setEmployeeAddress] = useState("");
  const [role, setRole] = useState("");
  const [salary, setSalary] = useState("");
  const [schedule, setSchedule] = useState("Weekly");
  const [customDate, setCustomDate] = useState("");
  const [pin, setPin] = useState("");

  // UI State
  const [loading, setLoading] = useState(false);
  const [processingStatus, setProcessingStatus] = useState("");
  const [isLoaded, setIsLoaded] = useState(false);
  const [autoPayEnabled, setAutoPayEnabled] = useState(false);
  const [activeTab, setActiveTab] = useState<'roster' | 'history'>('roster');
  const [paymentHistory, setPaymentHistory] = useState<PaymentRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [isRegistered, setIsRegistered] = useState(false);
  const [registrationError, setRegistrationError] = useState<string | null>(null);

  // Company Settings State
  const [companyName, setCompanyName] = useState<string>("");
  const [isCheckingCompany, setIsCheckingCompany] = useState(true);
  
  // Clockwork Bot State
  const [botKeypair, setBotKeypair] = useState<Keypair | null>(null);
  const [botBalance, setBotBalance] = useState(0);

  // Editing State
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<Employee>>({});
  const [editCustomDate, setEditCustomDate] = useState("");

  const calculateNextPayment = (sched: string, customDateStr?: string): number => {
      const now = Date.now();
      const oneDay = 86400 * 1000;
      
      if (sched === "Custom") {
          return customDateStr ? new Date(customDateStr).getTime() : now;
      }
      
      switch (sched) {
          case "Weekly": return now + (oneDay * 7);
          case "Bi-Weekly": return now + (oneDay * 14);
          case "Monthly": return now + (oneDay * 30);
          default: return now;
      }
  };

  // 1. Fetch Company Status
  const lastCheckTime = useRef<number>(0);

  useEffect(() => {
    if (!publicKey || !connection) {
       setIsCheckingCompany(false);
       return;
    }

    const checkRegistration = async () => {
      const now = Date.now();
      if (now - lastCheckTime.current < 5000) return; // Prevent spamming on rapid connection changes
      lastCheckTime.current = now;

      // 0. Optimistic Cache Check
      const cachedReg = localStorage.getItem("employer_registered") === "true";
      if (cachedReg) {
          console.log("Using cached registration status");
          setIsRegistered(true);
          setIsCheckingCompany(false); // Unblock UI
      } else {
          setIsCheckingCompany(true);
      }

      try {
        const exists = await checkCompanyRegistration(connection, publicKey);
        setIsRegistered(exists);

        if (exists) {
            localStorage.setItem("employer_registered", "true");
            const companyData = await fetchCompanyData(connection, publicKey);
            if (companyData && companyData.companyName) {
                setCompanyName(companyData.companyName);
            }
        }
      } catch (e: any) {
        console.error("Registration check failed", e);
        const msg = e.message || JSON.stringify(e);
        // If it's a 403/429 network error, assume they ARE registered (to be safe) or just show error.
        // Don't mark as not registered, which triggers redirect.
        if (msg.includes("403") || msg.includes("429") || msg.includes("Access forbidden") || msg.includes("fetch failed")) {
            setRegistrationError("Connection unstable. Retrying...");
            // Trigger RPC switch to find a better node
            switchEndpoint();
        } else {
             setRegistrationError("Failed to verify registration.");
        }
      } finally {
        setIsCheckingCompany(false);
      }
    };
    checkRegistration();
  }, [publicKey, connection]);

  // 2. Redirect Logic
  useEffect(() => {
     if (isCheckingCompany || !publicKey || registrationError) return;

     if (!isRegistered) {
        console.log("Not registered. Redirecting to signup...");
        router.push("/employer/signup");
     }
  }, [isCheckingCompany, isRegistered, publicKey, router, registrationError]);

  // 3. Load Employees & History
  useEffect(() => {
      if (!isRegistered || !publicKey) return;

      const loadData = async () => {
          try {
              // Load Employees
              console.log("Loading employees from on-chain...");

              // 1. Try Cache First (Stale-While-Revalidate)
              const CACHE_KEY = `confpay_employees_${publicKey.toBase58()}`;
              const cached = localStorage.getItem(CACHE_KEY);
              let hasCachedData = false;
              if (cached) {
                  try {
                      const parsed = JSON.parse(cached);
                      if (Array.isArray(parsed) && parsed.length > 0) {
                          console.log("Loaded cached employees:", parsed.length);
                          setEmployees(parsed);
                          setIsLoaded(true);
                          hasCachedData = true;
                      }
                  } catch (e) {
                      console.warn("Invalid cache", e);
                  }
              }

              // 2. Fetch Fresh Data
              const onChainData = await fetchAllEmployees(wallet, publicKey.toBase58(), connection);
              console.log(`Successfully loaded ${onChainData.length} employees.`);
              
              if (onChainData.length === 0) {
                  console.warn("No employees found on-chain for this employer.");
              }
              const mergedEmployees: Employee[] = await Promise.all(onChainData.map(async (emp: EmployeeData) => {
                  
                  // Default to "Confidential" to avoid immediate signature request
                  const decryptedSalary = "Confidential";
                  
                  // Logic for Bot: If Bot is enabled, it will need real values.
                  // We handle decryption via explicit user action ("Unlock") now.

                  return {
                      id: emp.wallet.toBase58(),
                      name: emp.name || "Unknown Worker",
                      role: emp.role,
                      address: emp.wallet.toBase58(),
                      salary: decryptedSalary,
                      lastPaid: (() => {
                        try {
                           if (emp.lastPaidTs.bitLength() <= 53) {
                               const ts = emp.lastPaidTs.toNumber();
                               return ts === 0 ? null : new Date(ts * 1000).toLocaleString();
                           }
                           return null;
                        } catch { return null; }
                      })(), 
                      pin: emp.pin,
                      // If nextPaymentTs is 0 or very small (legacy/uninitialized), default to Date.now()
                      // If nextPaymentTs is huge (> 100 billion), it's already in milliseconds (legacy bug), so don't multiply.
                      // Otherwise, it's seconds, so multiply by 1000.
                      nextPaymentDate: (() => {
                          try {
                              if (emp.nextPaymentTs.bitLength() > 53) {
                                  // Too big, likely garbage or futuristic, safe fallback
                                  return Date.now();
                              }
                              const ts = emp.nextPaymentTs.toNumber();
                              if (ts < 1000000) return Date.now();
                              return ts > 100000000000 ? ts : ts * 1000;
                          } catch { return Date.now(); }
                      })(),
                      schedule: emp.schedule,
                      encryptedSalary: emp.encryptedSalary,
                      inputType: emp.inputType
                  };
              }));

              setEmployees(mergedEmployees);
              setIsLoaded(true);

              // Load History - MOVED TO TAB CLICK to prevent 429s
              // setHistoryLoading(true);
              // try {
              //     const history = await fetchPaymentHistory(connection, publicKey.toBase58(), { role: "employer" });
              //     setPaymentHistory(history);
              // } catch (e: any) {
              //     setHistoryError(e.message || "Failed to load history");
              // } finally {
              //     setHistoryLoading(false);
              // }

          } catch (e: any) {
              console.error("Error loading dashboard data", e);
              const msg = e.message || JSON.stringify(e);
              if (msg.includes("403") || msg.includes("429") || msg.includes("Access forbidden")) {
                  console.warn("Rate limited during data load. Switching RPC...");
                  switchEndpoint();
              }
          }
      };

      loadData();
  }, [isRegistered, publicKey, connection]);

  const handleClearHistory = () => {
    if (!confirm("Are you sure you want to clear the payment history view? This will hide all past transactions from this dashboard.")) return;
    if (!publicKey) return;
    
    clearPaymentHistory(publicKey.toBase58());
    setPaymentHistory([]);
    alert("Payment history cleared from view.");
  };

  // New State for Decryption Status
  const [isDecrypted, setIsDecrypted] = useState(false);
  
  const handleUnlockSalaries = async () => {
      // Toggle Lock: Hide salaries if already decrypted
      if (isDecrypted) {
          setEmployees(prev => prev.map(e => {
              // Revert to "Confidential" if the employee has encrypted data
              if (e.encryptedSalary && e.encryptedSalary.length > 0) {
                  return { ...e, salary: "Confidential" };
              }
              return e;
          }));
          setIsDecrypted(false);
          return;
      }

      if (!walletContext.signMessage || !walletContext.publicKey) {
          alert("Wallet does not support message signing or not connected.");
          return;
      }
      
      setProcessingStatus("Decrypting salaries... Please sign the request.");
      setLoading(true);
      
      try {
          // Batch Decryption for Efficiency
          const confidentialEmployees = employees.filter(e => 
              e.salary === "Confidential" && 
              e.encryptedSalary && 
              e.encryptedSalary.length > 0
          );
          
          let updatedEmployees = [...employees];

          if (confidentialEmployees.length > 0) {
              try {
                const ciphertexts = confidentialEmployees.map(e => e.encryptedSalary);
                const plaintexts = await decryptSalaries(ciphertexts, walletContext);
                
                updatedEmployees = employees.map(emp => {
                    if (emp.salary !== "Confidential") return emp;
                    const idx = confidentialEmployees.findIndex(ce => ce.id === emp.id);
                    if (idx !== -1) {
                        const val = plaintexts[idx];
                        if (val !== null && val > 0) {
                             const plaintext = val.toString();
                             localStorage.setItem(`confpay_salary_${emp.address}`, plaintext);
                             return { ...emp, salary: plaintext };
                        }
                    }
                    return emp;
                });
              } catch (e) {
                 console.error("Batch decryption failed", e);
                 // alert("Failed to decrypt salaries. See console.");
                 // return; // Stop execution on batch failure
              }
          } else {
             console.log("No confidential employees with valid ciphertext to decrypt.");
          }

          setEmployees(updatedEmployees);
          setIsDecrypted(true);
          setProcessingStatus("");
      } catch (e) {
          console.error("Decryption process failed:", e);
          // alert("Failed to decrypt salaries. See console.");
      } finally {
          setLoading(false);
      }
  };
  
  // 4. Initialize Bot & Auto-Pay from Local Storage
  useEffect(() => {
      // Load Bot Keypair
      const stored = localStorage.getItem("confpay_bot_secret");
      if (stored) {
          try {
              const secretKey = Uint8Array.from(JSON.parse(stored));
              const kp = Keypair.fromSecretKey(secretKey);
              setBotKeypair(kp);
              
              // Check balance
              if (connection) {
                  connection.getBalance(kp.publicKey)
                    .then(bal => setBotBalance(bal / LAMPORTS_PER_SOL))
                    .catch(e => {
                        console.warn("Failed to fetch bot balance:", e);
                        // Don't crash, just show 0 or keep previous
                    });
              }
          } catch (e) {
              console.error("Failed to load bot keypair", e);
          }
      }

      // Load Auto-Pay Status
      const autoPaySaved = localStorage.getItem("confpay_autopay_enabled");
      if (autoPaySaved === "1") {
          setAutoPayEnabled(true);
      }
  }, [connection]);

  const [botStatus, setBotStatus] = useState<string>("Idle");

  // 5. Bot Loop
  useEffect(() => {
    if (!autoPayEnabled || !botKeypair || !employees.length || !isRegistered || !publicKey || !connection) {
        setBotStatus("Idle");
        return;
    }

    const runBotCheck = async () => {
        const now = Date.now();
        console.log("Bot checking for payments...");
        setBotStatus("Scanning for due payments...");
        
        let foundDue = false;

        for (const emp of employees) {
            // Check if due (nextPaymentDate must be valid > 0)
            if (emp.nextPaymentDate > 0 && now >= emp.nextPaymentDate) {
                foundDue = true;
                
                // SAFETY CHECK 1: Local Storage (Browser Session Persistence)
                // This prevents double-payment if the page is refreshed or if on-chain update fails/lags.
                const lastPaidKey = `confpay_last_paid_${emp.address}`;
                const lastPaidLocal = localStorage.getItem(lastPaidKey);
                if (lastPaidLocal) {
                     const timeSince = now - parseInt(lastPaidLocal);
                     if (timeSince < 15 * 60 * 1000) { // 15 Minutes
                         console.log(`Skipping ${emp.name} - Paid recently (Local Check)`);
                         continue;
                     }
                }

                // SAFETY CHECK 2: On-Chain Data (if available)
                if (emp.lastPaid) {
                    const lastPaidTime = new Date(emp.lastPaid).getTime();
                    if (now - lastPaidTime < 15 * 60 * 1000) {
                        console.log(`Skipping ${emp.name} - Paid recently (Chain Check)`);
                        continue;
                    }
                }

                console.log(`Bot paying ${emp.name}...`);
                setBotStatus(`Processing payment for ${emp.name}...`);
                
                try {
                    // 1. Pay SOL
                    let amount = parseFloat(emp.salary);
                    
                    // Fallback to local storage for Bot if salary is Confidential
                    if (isNaN(amount) || amount <= 0) {
                         const stored = localStorage.getItem(`confpay_salary_${emp.address}`);
                         if (stored) {
                             const storedAmount = parseFloat(stored);
                             if (!isNaN(storedAmount) && storedAmount > 0) {
                                 amount = storedAmount;
                                 console.log(`Bot recovered salary from storage for ${emp.name}: ${amount}`);
                             } else {
                                 console.warn(`Bot found invalid salary in storage for ${emp.name}: ${stored}`);
                             }
                         }
                    }

                    if (isNaN(amount) || amount <= 0) {
                        console.log(`Skipping ${emp.name} - Salary unknown/invalid`);
                        setBotStatus(`⚠️ Need Unlock: Cannot pay ${emp.name}`);
                        continue;
                    }

                    const solTx = await payEmployee(
                        connection,
                        botKeypair,
                        emp.address,
                        amount
                    );
                    console.log(`Bot paid SOL: ${solTx}`);
                    
                    // Mark as paid locally IMMEDIATELY to prevent race conditions
                    localStorage.setItem(lastPaidKey, now.toString());

                    // 2. Update On-Chain Record
                    // The Smart Contract now handles "Custom" -> "Weekly" switch automatically in pay_employee!
                    try {
                        const stateTx = await payEmployeeTransaction(
                            new BotWallet(botKeypair),
                            publicKey.toBase58(),
                            emp.address
                        );
                        console.log(`Bot updated state: ${stateTx}`);

                        // 3. Update Local State Optimistically
                        setEmployees(prev => prev.map(e => {
                            if (e.id === emp.id) {
                                // Logic matches Rust Contract:
                                // If Custom, it becomes Weekly.
                                // Next Date is always +7 days (Weekly) or based on existing schedule.
                                
                                let newSchedule = e.schedule;
                                if (e.schedule === "Custom") {
                                    newSchedule = "Weekly";
                                }
                                
                                const nextDate = emp.nextPaymentDate + (86400 * 1000 * 7); // Maintain schedule (anchor + 7 days) to catch up on missed payments
                                
                                return { 
                                    ...e, 
                                    lastPaid: new Date().toLocaleString(),
                                    nextPaymentDate: nextDate,
                                    schedule: newSchedule
                                };
                            }
                            return e;
                        }));

                    } catch (stateErr) {
                        console.error("Bot paid SOL but failed to update on-chain state:", stateErr);
                    }

                } catch (e) {
                    console.error(`Bot failed to pay ${emp.name}`, e);
                    setBotStatus(`Error paying ${emp.name}`);
                }
            }
        }
        
        if (!foundDue) {
             setBotStatus("Active - No payments due");
        }
    };

    // Run immediately on mount/update
    runBotCheck();

    const interval = setInterval(runBotCheck, 60000); // Check every minute

    return () => clearInterval(interval);
  }, [autoPayEnabled, botKeypair, employees, isRegistered, publicKey, connection]);

   // Edit Functionality
  const saveEdit = async () => {
    if (!editingId || !publicKey || !anchorWallet) return;

    const employee = employees.find(e => e.id === editingId);
    if (!employee) return;
    
    setLoading(true);
    
    try {
        // 1. Prepare data for update
        const newName = editForm.name || employee.name;
        const newRole = editForm.role || employee.role;
        const newPin = editForm.pin || employee.pin;
        const newSchedule = editForm.schedule || employee.schedule;
        
        // Calculate Next Payment Date
        const nextPaymentDate = calculateNextPayment(newSchedule, editCustomDate || new Date(employee.nextPaymentDate).toISOString());

        // 2. Encrypt new salary ONLY if changed or if we have a valid plaintext value
        let ciphertext = employee.encryptedSalary;
        let inputType = employee.inputType;

        if (editForm.salary && editForm.salary !== "Confidential") {
             const newSalaryVal = parseFloat(editForm.salary);
             if (isNaN(newSalaryVal)) {
                 throw new Error("Invalid salary value entered");
             }
             const encrypted = await encryptSalary(newSalaryVal, employee.address, editForm.pin || employee.pin, walletContext);
             ciphertext = Array.from(encrypted.ciphertext); // Ensure array
             inputType = encrypted.input_type;
        } else if (!ciphertext || ciphertext.length === 0) {
             // Attempt to recover ciphertext from local storage if missing
             const localSalary = localStorage.getItem(`confpay_salary_${employee.address}`);
             if (localSalary) {
                 console.log("Recovering ciphertext from local salary...");
                 const encrypted = await encryptSalary(parseFloat(localSalary), employee.address, editForm.pin || employee.pin, walletContext);
                 ciphertext = Array.from(encrypted.ciphertext);
                 inputType = encrypted.input_type;
             }
        }

       // 3. Send On-Chain Transaction
       const txSignature = await updateEmployeeTransaction(
           anchorWallet,
           publicKey.toBase58(),
           employee.address,
           newName,
           newRole,
           ciphertext,
           inputType,
           newPin,
           newSchedule,
           nextPaymentDate
       );

        console.log("Update Transaction Signature:", txSignature);
        setProcessingStatus(`Employee updated! TX: ${txSignature.slice(0, 8)}...`);

        // Save to Local Storage for persistence (ONLY if valid number)
        const salaryNum = parseFloat(editForm.salary || "");
        if (!isNaN(salaryNum) && salaryNum > 0) {
            localStorage.setItem(`confpay_salary_${employee.address}`, editForm.salary!);
        } else {
            console.log("Skipping local storage update: Salary is invalid or Confidential");
        }

        // 4. Update Local State
        setEmployees(prev => {
               const updated = prev.map(e => {
                   if (e.id === editingId) {
                       return { 
                           ...e, 
                           ...editForm, 
                           nextPaymentDate,
                           encryptedSalary: ciphertext,
                           inputType: inputType,
                           // Update displayed salary only if edited
                           salary: editForm.salary || e.salary 
                       } as Employee;
                   }
                   return e;
               });
               
               return updated;
           });

        alert("Employee updated successfully on-chain!");
     } catch (error) {
         console.error("Failed to update employee:", error);
         alert("Failed to update employee on-chain. Please check console for details.");
     } finally {
         setLoading(false);
         setEditingId(null);
         setEditForm({});
         setProcessingStatus("");
     }
   };
 
   const handleAddEmployee = async (e: React.FormEvent) => {
     e.preventDefault();
     if (!publicKey || !wallet) {
         alert("Please connect your wallet first.");
         return;
     }

     if (!anchorWallet) {
         alert("Wallet adapter not ready. Please try again.");
         return;
     }
 
     setLoading(true);
     setProcessingStatus("Encrypting Salary & Processing Transaction...");
     
     // Note to user about double signing
     console.log("Note: You may be asked to sign twice: once for encryption (off-chain) and once for the transaction (on-chain).");

     try {
         // 1. Encrypt Salary
         const salaryNum = parseFloat(salary);
         if (isNaN(salaryNum)) {
             throw new Error("Invalid salary amount");
         }
         const { ciphertext, input_type } = await encryptSalary(salaryNum, employeeAddress, pin, walletContext);

        // Calculate Next Payment Date
        const nextPaymentDate = calculateNextPayment(schedule, customDate);

        const txSignature = await addEmployeeTransaction(
          anchorWallet,
          publicKey.toBase58(),
          employeeAddress,
          employeeName,
          role,
          ciphertext,
          input_type,
          pin,
          schedule,
          nextPaymentDate
        );

        console.log("Transaction Signature:", txSignature);
        setProcessingStatus(`Success! TX: ${txSignature.slice(0, 8)}...`);

        // Save to Local Storage for persistence
        localStorage.setItem(`confpay_salary_${employeeAddress}`, salary);

        // 3. Optimistically Add to State
        const newEmployee: Employee = {
            id: employeeAddress, // Using wallet as ID for now
            name: employeeName,
            address: employeeAddress,
            role: role,
            salary: salary,
            lastPaid: null,
            pin: pin,
            nextPaymentDate: nextPaymentDate,
            schedule: schedule,
            encryptedSalary: Array.from(ciphertext),
            inputType: input_type
        };

        const updatedEmployees = [...employees, newEmployee];
        setEmployees(updatedEmployees);

        // 4. Reset Form
         setEmployeeName("");
         setEmployeeAddress("");
         setRole("");
         setSalary("");
         setPin("");
         setSchedule("Weekly");
         setCustomDate("");
         
     } catch (error) {
         console.error("Error adding employee:", error);
         setProcessingStatus("Failed to add employee. Please check logs.");
         alert("Failed to add employee. See console for details.");
     } finally {
         setLoading(false);
         setTimeout(() => setProcessingStatus(""), 5000);
     }
   };
 
   // --- Helpers ---
   const startEditing = (emp: Employee) => {
    setEditingId(emp.id);
    // Try to recover salary from local storage if it is Confidential
    let editableSalary = emp.salary;
    if (emp.salary === "Confidential") {
        const stored = localStorage.getItem(`confpay_salary_${emp.address}`);
        if (stored && !isNaN(parseFloat(stored))) {
            editableSalary = stored;
        }
    }

    setEditForm({
        name: emp.name,
        role: emp.role,
        address: emp.address,
        salary: editableSalary,
        pin: emp.pin,
        schedule: emp.schedule
    });
    // Pre-fill custom date if needed, converting timestamp to datetime-local format
     const date = new Date(emp.nextPaymentDate);
     // Adjust to local ISO string (handling timezone offset manually to avoid UTC conversion)
     const offset = date.getTimezoneOffset() * 60000;
     const localISOTime = (new Date(date.getTime() - offset)).toISOString().slice(0, 16);
     setEditCustomDate(localISOTime);
   };
 
   const cancelEdit = () => {
     setEditingId(null);
     setEditForm({});
   };
 
   const removeEmployee = async (id: string) => {
    if (!confirm("Are you sure you want to remove this employee? This action is irreversible on-chain.")) return;

    if (!publicKey || !wallet) {
      alert("Please connect your wallet first.");
      return;
    }

    if (!anchorWallet) {
        alert("Wallet adapter not ready. Please try again.");
        return;
    }

    setLoading(true);
    setProcessingStatus("Processing On-Chain Removal...");

    try {
       // Find the employee to get the wallet address
       const emp = employees.find(e => e.id === id);
       if (!emp) throw new Error("Employee not found locally");

       const txSignature = await removeEmployeeTransaction(
         anchorWallet,
         publicKey.toBase58(),
         emp.address
       );

       console.log("Remove Transaction Signature:", txSignature);
       setProcessingStatus(`Employee removed! TX: ${txSignature.slice(0, 8)}...`);

       // Update Local State
       setEmployees(prev => prev.filter(e => e.id !== id));
       
       alert("Employee removed successfully on-chain!");
    } catch (error: any) {
       console.error("Failed to remove employee:", error);
       // Show detailed error message
       const errorMsg = error.message || JSON.stringify(error);
       alert(`Failed to remove employee: ${errorMsg}\n\nCheck console for full logs.`);
    } finally {
       setLoading(false);
       setTimeout(() => setProcessingStatus(""), 5000);
    }
  };
   
   const handleManualPay = async (emp: Employee) => {
    if (!wallet || !publicKey || !anchorWallet) return;
    
    let amount = parseFloat(emp.salary);
    
    // 1. Try Local Storage first (Fastest, no signature)
    if (isNaN(amount)) {
       const stored = localStorage.getItem(`confpay_salary_${emp.address}`);
       if (stored) {
           amount = parseFloat(stored);
           console.log(`Recovered salary from local storage: ${amount}`);
       }
    }

    // 2. Try On-the-fly Decryption if still unknown
    if ((isNaN(amount) || amount <= 0) && emp.encryptedSalary && emp.encryptedSalary.length > 0) {
        try {
            console.log("Attempting on-the-fly decryption...");
            const decrypted = await decryptSalary(emp.encryptedSalary, walletContext);
            if (decrypted !== null && decrypted > 0) {
                amount = decrypted;
                // Save for future use
                localStorage.setItem(`confpay_salary_${emp.address}`, amount.toString());
            }
        } catch (e) {
            console.warn("On-the-fly decryption failed", e);
        }
    }
    
    // 3. Fallback: Manual Entry
    if (isNaN(amount) || amount <= 0) {
        const manual = prompt(`Salary unknown. Enter amount for ${emp.name} (SOL):`);
        if (manual) amount = parseFloat(manual);
    }

    if (isNaN(amount) || amount <= 0) {
        alert("Invalid salary amount. Could not decrypt or retrieve from storage.");
        return;
    }

    if (!confirm(`Confirm payment of ${amount} SOL to ${emp.name}?`)) return;

     setLoading(true);
     try {
         // 1. Send SOL
         const signature = await payEmployee(
             connection,
             walletContext,
             emp.address,
             amount
         );
         console.log("Payment sent:", signature);
         setProcessingStatus("Updating payment record...");

         // 2. Update On-Chain Record (Last Paid & Next Payment Date)
         let recordUpdated = false;
         try {
             // 15s timeout for record update
             const updatePromise = payEmployeeTransaction(
                anchorWallet,
                publicKey.toBase58(),
                emp.address
             );
             
             const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error("Record update timed out")), 15000)
             );

             await Promise.race([updatePromise, timeoutPromise]);
             recordUpdated = true;
         } catch (updateError) {
             console.warn("Record update failed or timed out:", updateError);
             // We don't block the UI for this error, since money was sent
         }

         setLoading(false); // Unlock UI immediately
         setProcessingStatus("");
         
         if (recordUpdated) {
             alert(`Payment successful! SOL sent & Record updated.`);
         } else {
             alert(`Payment successful! SOL sent.\n\nNote: On-chain record update failed (or timed out). 'Last Paid' date may lag.`);
         }
         
         // Update Local State Optimistically
         setEmployees(prev => prev.map(e => {
             if (e.id === emp.id) {
                 const nextDate = calculateNextPayment(e.schedule);
                 return { 
                     ...e, 
                     lastPaid: new Date().toLocaleString(),
                     nextPaymentDate: nextDate 
                 };
             }
             return e;
         }));

         // Refresh history in background
         loadHistory();
     } catch (e: any) {
         setLoading(false);
         setProcessingStatus("");
         console.error("Payment failed", e);
         alert("Payment failed: " + (e.message || "Unknown error"));
     } finally {
         setLoading(false);
         setProcessingStatus("");
     }
   };

   const handleRunPayroll = async () => {
       alert("Payroll automation coming soon!");
   };
 
   const createBot = () => {
     const kp = Keypair.generate();
     setBotKeypair(kp);
     localStorage.setItem("confpay_bot_secret", JSON.stringify(Array.from(kp.secretKey)));
   };
 
   const fundBot = async () => {
    if (!botKeypair || !wallet || !publicKey) return;
    const amount = prompt("How much SOL to deposit?", "1.0");
    if (!amount) return;

    setLoading(true);
    try {
        const signature = await payEmployee(
            connection,
            walletContext, 
            botKeypair.publicKey.toBase58(),
            parseFloat(amount)
        );
        alert(`Bot funded! TX: ${signature.slice(0, 8)}...`);
        
        // Update balance
        await new Promise(r => setTimeout(r, 2000));
        if (botKeypair) {
             try {
                 const bal = await connection.getBalance(botKeypair.publicKey);
                 setBotBalance(bal / LAMPORTS_PER_SOL);
             } catch (e) {
                 console.warn("Failed to update bot balance:", e);
             }
        }
    } catch (e) {
        console.error("Funding failed", e);
        alert("Funding failed");
    } finally {
        setLoading(false);
    }
  };

  const loadHistory = async () => {
     // Refresh history
     if (!publicKey) return;
     if (historyLoading) return; // Prevent concurrent fetches

     setHistoryLoading(true);
     setHistoryError(null);
    try {
        const additional = botKeypair ? [botKeypair.publicKey.toBase58()] : [];
        const employeeAddresses = employees.map(e => e.address);
        console.log("Loading history with additional senders & employees:", additional, employeeAddresses.length);
        
        const history = await fetchPaymentHistory(
            connection, 
            publicKey.toBase58(), 
            true, 
            [], 
            additional,
            employeeAddresses // Scan employees too
        );
        setPaymentHistory(history);
    } catch (e: any) {
         console.error("History refresh failed", e);
         setHistoryError("Failed to load history. Please try again.");
     } finally {
         setHistoryLoading(false);
     }
 };

  const toggleTheme = () => {
      document.documentElement.classList.toggle('darkmode-invert');
      const isDark = document.documentElement.classList.contains('darkmode-invert');
      localStorage.setItem('confpay_theme', isDark ? 'dark' : 'light');
  };

  useEffect(() => {
      const stored = localStorage.getItem('confpay_theme');
      if (stored === 'dark') {
          document.documentElement.classList.add('darkmode-invert');
      }
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-8 animate-fade-in">
      <header className="flex flex-col md:flex-row justify-between items-center mb-8 md:mb-12 gap-6 md:gap-0">
        <div className="flex items-center gap-4 w-full md:w-auto justify-center md:justify-start">
          <Link href="/">
             <img 
               src="/logo.png" 
               alt="ConfPay" 
               className="w-10 h-10 object-contain rounded-full border border-gray-200 shadow-sm hover:scale-105 transition-transform cursor-pointer logo-light" 
             />
             <img 
               src="/logo2.png" 
               alt="ConfPay" 
               className="w-10 h-10 object-contain rounded-full border border-gray-200 shadow-sm hover:scale-105 transition-transform cursor-pointer logo-dark" 
             />
          </Link>
          <h1 className="text-xl md:text-2xl font-bold text-gray-900 heading-cyan">
            {companyName || "Employer Dashboard"}
          </h1>
        </div>
        <div className="flex items-center justify-center gap-2 md:gap-4 w-full md:w-auto flex-wrap">
           {employees.length > 0 && (
               <button
                  onClick={handleUnlockSalaries}
                  disabled={loading}
                  className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm flex items-center gap-2"
               >
                  {loading ? (
                    <>
                       <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                       {processingStatus || "Processing..."}
                    </>
                  ) : isDecrypted ? (
                    <>
                       🔒 Lock Payroll
                    </>
                  ) : (
                    <>
                       🔓 Unlock Payroll
                    </>
                  )}
               </button>
           )}

          {publicKey && (
            <span className="text-sm text-gray-500 hidden md:block">
              {publicKey.toBase58().slice(0, 4)}...
              {publicKey.toBase58().slice(-4)}
            </span>
          )}
          <button
            onClick={toggleTheme}
            className="p-2 rounded-full bg-gray-100 hover:bg-gray-200 transition-colors"
            title="Toggle Theme"
          >
            🌓
          </button>
          <WalletMultiButton />
        </div>
      </header>

      {/* Main Grid */}
      <div className="grid md:grid-cols-3 gap-8">
        {/* Left Column: Stats & Actions */}
        <div className="space-y-8">
          {/* Add Employee Card */}
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
            <h2 className="text-lg font-semibold mb-4 text-gray-900">
              Add New Employee
            </h2>
            <form onSubmit={handleAddEmployee} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Employee Name
                </label>
                <input
                  type="text"
                  placeholder="John Doe"
                  className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                  value={employeeName}
                  onChange={(e) => setEmployeeName(e.target.value)}
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Wallet Address
                </label>
                <input
                  type="text"
                  placeholder="Solana Wallet Address"
                  className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all font-mono text-sm"
                  value={employeeAddress}
                  onChange={(e) => setEmployeeAddress(e.target.value)}
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Role
                  </label>
                  <input
                    type="text"
                    placeholder="Dev"
                    className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Salary (SOL)
                  </label>
                  <input
                    type="text"
                    placeholder="0.0"
                    className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                    value={salary}
                    onChange={(e) => {
                        const val = e.target.value;
                        if (val === "" || /^\d*\.?\d*$/.test(val)) {
                            setSalary(val);
                        }
                    }}
                    required
                  />
                </div>
              </div>

              <div>
                 <label className="block text-sm font-medium text-gray-700 mb-1">
                    Access PIN (4 digits)
                 </label>
                 <div className="flex gap-2">
                    <input
                      type="text"
                      maxLength={4}
                      placeholder="1234"
                      className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all text-center tracking-widest"
                      value={pin}
                      onChange={(e) => setPin(e.target.value.replace(/\\D/g, ''))}
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setPin(Math.floor(1000 + Math.random() * 9000).toString())}
                      className="px-3 py-2 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 text-xs"
                    >
                      Gen
                    </button>
                 </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Payment Schedule
                </label>
                <select
                  className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all bg-white"
                  value={schedule}
                  onChange={(e) => setSchedule(e.target.value)}
                >
                  <option value="Weekly">Weekly</option>
                  <option value="Bi-Weekly">Bi-Weekly</option>
                  <option value="Monthly">Monthly</option>
                  <option value="Custom">Custom</option>
                </select>
                {schedule === "Custom" && (
                    <div className="mt-2 animate-fade-in">
                        <label className="block text-xs font-medium text-gray-500 mb-1">
                            Select Date & Time
                        </label>
                        <input
                            type="datetime-local"
                            className="w-full px-4 py-2 rounded-lg border border-gray-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                            value={customDate}
                            onChange={(e) => setCustomDate(e.target.value)}
                            required
                        />
                    </div>
                )}
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg shadow-lg shadow-blue-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed mt-2 cyan-glow"
              >
                {loading ? "Processing..." : "Add Employee"}
              </button>
            </form>
          </div>

          {/* Quick Stats */}
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">
              Payroll Overview
            </h3>
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-gray-600">Total Employees</span>
                <span className="text-2xl font-bold text-gray-900">
                  {employees.length}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-600">Total Monthly</span>
                <div className="flex flex-col items-end">
                    <span className="text-2xl font-bold text-gray-900">
                      {(() => {
                          const total = employees.reduce((acc, curr) => {
                              const val = parseFloat(curr.salary);
                              return acc + (isNaN(val) ? 0 : val);
                          }, 0);
                          const hasConfidential = employees.some(e => isNaN(parseFloat(e.salary)));
                          
                          if (total === 0 && hasConfidential) return "Confidential";
                          return `${total.toFixed(2)} SOL${hasConfidential ? "*" : ""}`;
                      })()}
                    </span>
                    {employees.some(e => isNaN(parseFloat(e.salary))) && (
                        <div className="text-xs text-gray-400 mt-1">* Includes hidden amounts</div>
                    )}
                </div>
              </div>
            </div>
            
             {/* Auto-Pay Toggle */}
             <div className="mt-6 pt-6 border-t border-gray-100">
               <div className="flex items-center justify-between p-3 bg-gray-900 rounded-lg border border-gray-700">
                 <span className="text-sm text-gray-100 font-bold">Auto-Pay Status</span>
                 <button
                   onClick={() => {
                       const newState = !autoPayEnabled;
                       setAutoPayEnabled(newState);
                       localStorage.setItem("confpay_autopay_enabled", newState ? "1" : "0");
                   }}
                   className={`px-4 py-1 rounded-full text-xs font-bold transition-all transform hover:scale-105 ${
                    autoPayEnabled 
                     ? "bg-green-500 text-white shadow-lg shadow-green-200" 
                     : "bg-gray-400 text-white"
                   }`}
                 >
                   {autoPayEnabled ? "ACTIVE" : "PAUSED"}
                 </button>
               </div>
               
               {/* Bot Status Details */}
               <div className="mt-2 bg-gray-900 rounded-lg p-3 text-xs font-mono text-gray-400 border border-gray-700">
                   <div className="flex justify-between mb-1">
                       <span>Bot Balance:</span>
                       <span className={botKeypair && botBalance < 0.1 ? "text-red-400" : "text-green-400"}>
                           {botKeypair ? `${botBalance.toFixed(3)} SOL` : "Not Init"}
                       </span>
                   </div>
                   {botKeypair && (
                       <div className="truncate mb-2 text-[10px] opacity-70">
                           {botKeypair.publicKey.toBase58()}
                       </div>
                   )}
                   <div className="pt-2 border-t border-gray-800">
                        <div className="flex items-center gap-2">
                            <span className={`w-2 h-2 rounded-full ${autoPayEnabled ? "bg-green-500 animate-pulse" : "bg-gray-500"}`}></span>
                            <span className="text-blue-300">{botStatus}</span>
                        </div>
                   </div>
                   
                   {!botKeypair && (
                       <button onClick={createBot} className="mt-2 w-full py-1 bg-blue-600 text-white rounded hover:bg-blue-700">
                           Initialize Bot
                       </button>
                   )}
                   
                   {botKeypair && (
                       <div className="mt-2">
                           {botBalance < 0.05 && (
                               <div className="text-red-500 font-bold mb-1 text-center">⚠️ Low Balance!</div>
                           )}
                           <button onClick={fundBot} className="w-full py-1 bg-blue-600 text-white rounded hover:bg-blue-700 font-medium transition-colors">
                               Fund Bot
                           </button>
                       </div>
                   )}
               </div>
               <div className="text-[10px] text-center text-gray-400 mt-2">
                   Powered by Clockwork Automation <br/>
                   <span className="text-yellow-500/80">⚠️ Keep tab open for auto-payments</span>
               </div>
             </div>
          </div>
        </div>

        {/* Right Column: Roster & History */}
        <div className="md:col-span-2 space-y-6">
          
          {/* Tabs */}
          <div className="flex justify-between items-end border-b border-gray-200">
            <div className="flex space-x-4">
              <button
                 onClick={() => setActiveTab('roster')}
                 className={`pb-2 px-1 text-sm font-medium transition-colors ${
                    activeTab === 'roster' 
                    ? 'border-b-2 border-blue-600 text-blue-600' 
                    : 'text-gray-500 hover:text-gray-700'
                 }`}
              >
                 Employee Roster
              </button>
              <button
                 onClick={() => { setActiveTab('history'); loadHistory(); }}
                 className={`pb-2 px-1 text-sm font-medium transition-colors ${
                    activeTab === 'history' 
                    ? 'border-b-2 border-blue-600 text-blue-600' 
                    : 'text-gray-500 hover:text-gray-700'
                 }`}
              >
                 Payment History
              </button>
            </div>
            {activeTab === 'roster' && (
                <button 
                  onClick={() => window.location.reload()} // Simple refresh for now to trigger loadData
                  className="mb-2 text-xs text-blue-600 hover:underline"
                >
                  Refresh Roster
                </button>
            )}
          </div>

          {activeTab === 'roster' ? (
             <div className="space-y-4">
                {employees.length === 0 ? (
                  <div className="text-center py-12 bg-white rounded-xl border border-dashed border-gray-300">
                    <p className="text-gray-500">No employees added yet.</p>
                  </div>
                ) : (
                  employees.map((emp) => (
                    <div key={emp.id} className="p-4 bg-white rounded-lg border border-gray-200 shadow-sm transition-all hover:shadow-md">
                      {editingId === emp.id ? (
                         <div className="flex-1 space-y-3">
                           {/* Name (Editable) */}
                           <div>
                              <label className="text-xs text-gray-500 font-bold uppercase">Name</label>
                              <input 
                                 className="w-full p-1 border rounded" 
                                 maxLength={50}
                                 value={editForm.name || emp.name}
                                 onChange={e => setEditForm({...editForm, name: e.target.value})}
                              />
                           </div>
                           
                           <div className="grid grid-cols-2 gap-4">
                               <div>
                                  <label className="text-xs text-gray-500 font-bold uppercase">Role</label>
                                  <input 
                                     className="w-full p-1 border rounded" 
                                     maxLength={32}
                                     value={editForm.role || emp.role}
                                     onChange={e => setEditForm({...editForm, role: e.target.value})}
                                  />
                               </div>
                               <div>
                                  <label className="text-xs text-gray-500 font-bold uppercase">Salary</label>
                                  <input 
                                     className="w-full p-1 border rounded" 
                                     type="text"
                                     placeholder="SOL Amount"
                                     value={editForm.salary || emp.salary}
                                     onChange={e => setEditForm({...editForm, salary: e.target.value})}
                                  />
                               </div>
                           </div>
                           
                           <div className="grid grid-cols-2 gap-4">
                               <div>
                                  <label className="text-xs text-gray-500 font-bold uppercase">PIN</label>
                                  <input 
                                     className="w-full p-1 border rounded" 
                                     maxLength={4}
                                     value={editForm.pin || emp.pin}
                                     onChange={e => setEditForm({...editForm, pin: e.target.value})}
                                  />
                               </div>
                               <div>
                                  <label className="text-xs text-gray-500 font-bold uppercase">Schedule</label>
                                  <select 
                                     className="w-full p-1 border rounded"
                                     value={editForm.schedule || emp.schedule}
                                     onChange={e => setEditForm({...editForm, schedule: e.target.value})}
                                  >
                                      <option value="Weekly">Weekly</option>
                                      <option value="Bi-Weekly">Bi-Weekly</option>
                                      <option value="Monthly">Monthly</option>
                                      <option value="Custom">Custom</option>
                                  </select>
                                  {(editForm.schedule === "Custom" || (!editForm.schedule && emp.schedule === "Custom")) && (
                                     <input 
                                         type="datetime-local"
                                         className="w-full mt-1 p-1 border rounded text-xs"
                                         value={editCustomDate}
                                         onChange={e => setEditCustomDate(e.target.value)}
                                     />
                                  )}
                               </div>
                           </div>

                           <div className="flex justify-end gap-2 mt-4">
                              <button onClick={cancelEdit} className="px-3 py-1 text-gray-600 hover:bg-gray-100 rounded">Cancel</button>
                              <button onClick={saveEdit} className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700">Save Changes</button>
                           </div>
                         </div>
                      ) : (
                         <div className="flex justify-between items-start">
                            <div className="flex-1">
                               <div className="flex justify-between items-center mb-2">
                                  <h3 className="font-bold text-gray-900">{emp.name}</h3>
                                  <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">
                                     {emp.role}
                                  </span>
                               </div>
                               
                               <div className="grid grid-cols-2 gap-4 text-sm text-gray-600 mb-3">
                                  <div>
                                     <span className="block text-xs text-gray-400 uppercase">Wallet</span>
                                     <span className="font-mono text-xs">
                                        {emp.address.slice(0, 4)}...{emp.address.slice(-4)}
                                     </span>
                                  </div>
                                  <div>
                                     <span className="block text-xs text-gray-400 uppercase">Salary</span>
                                     <span className="font-medium text-gray-900">{emp.salary} SOL</span>
                                  </div>
                               </div>

                               <div className="grid grid-cols-2 gap-4 text-sm text-gray-600 mb-3 bg-blue-50 p-2 rounded border border-blue-100">
                                  <div>
                                     <span className="block text-xs text-blue-500 font-bold uppercase">Next Due</span>
                                     <span className="text-xs font-medium text-gray-800">
                                        {emp.nextPaymentDate > 0 ? new Date(emp.nextPaymentDate).toLocaleString() : "Not Scheduled"}
                                     </span>
                                  </div>
                                  <div>
                                     <span className="block text-xs text-blue-500 font-bold uppercase">Last Paid</span>
                                     <span className="text-xs font-medium text-gray-800">
                                        {emp.lastPaid || "Never"}
                                     </span>
                                  </div>
                               </div>
                               
                               <div className="flex items-center gap-4 text-xs text-gray-500">
                                  <span className="flex items-center gap-1">
                                     🕒 {emp.schedule}
                                  </span>
                                  <span className="flex items-center gap-1">
                                     🔒 PIN: ****
                                  </span>
                               </div>
                            </div>
                            
                            <div className="flex flex-col gap-2 ml-4">
                               <button 
                                 onClick={() => handleManualPay(emp)}
                                 disabled={loading}
                                 className="text-green-600 hover:text-green-800 text-xs font-bold border border-green-200 bg-green-50 px-2 py-1 rounded hover:bg-green-100 transition-colors"
                               >
                                 Pay Now
                               </button>
                               <button 
                                 onClick={() => startEditing(emp)}
                                 className="text-blue-600 hover:text-blue-800 text-xs font-medium"
                               >
                                 Edit
                               </button>
                               <button 
                                 onClick={() => removeEmployee(emp.id)}
                                 className="text-red-500 hover:text-red-700 text-xs font-medium"
                               >
                                 Remove
                               </button>
                            </div>
                         </div>
                      )}
                    </div>
                  ))
                )}
             </div>
          ) : (
             <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="flex justify-between items-center p-4 bg-gray-50 border-b border-gray-100">
                    <h3 className="text-sm font-bold text-gray-700">Recent Transactions</h3>
                    {paymentHistory.length > 0 && (
                        <button
                          onClick={handleClearHistory}
                          className="text-xs text-red-500 hover:text-red-700 font-medium transition-colors"
                        >
                          Clear History View
                        </button>
                    )}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-gray-50 text-gray-500 font-medium border-b border-gray-100">
                      <tr>
                        <th className="px-6 py-4">Date</th>
                        <th className="px-6 py-4">Employee</th>
                        <th className="px-6 py-4">Amount</th>
                        <th className="px-6 py-4">Status</th>
                        <th className="px-6 py-4">TX</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {historyLoading ? (
                          <tr><td colSpan={5} className="text-center py-4">Loading history...</td></tr>
                      ) : historyError ? (
                          <tr>
                              <td colSpan={5} className="text-center py-4 text-red-500">
                                  {historyError} <br/>
                                  <button onClick={loadHistory} className="mt-2 text-xs underline text-blue-600">Retry</button>
                              </td>
                          </tr>
                      ) : paymentHistory.length === 0 ? (
                          <tr><td colSpan={5} className="text-center py-4 text-gray-500">No payment history found.</td></tr>
                      ) : (
                          paymentHistory.map((record, i) => (
                             <tr key={i} className="hover:bg-gray-50 transition-colors">
                                <td className="px-6 py-4 text-gray-600">
                                   {new Date(record.timestamp).toLocaleDateString()}
                                </td>
                                <td className="px-6 py-4 font-medium text-gray-900">
                                   {employees.find(e => e.address === record.recipient)?.name || record.recipient.slice(0, 8) + '...'}
                                </td>
                                <td className="px-6 py-4 text-gray-900">
                                   {record.amount.toFixed(2)} SOL
                                </td>
                                <td className="px-6 py-4">
                                   <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-50 text-green-700">
                                     <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
                                     Completed
                                   </span>
                                </td>
                                <td className="px-6 py-4">
                                   <a 
                                      href={`https://explorer.solana.com/tx/${record.signature}?cluster=devnet`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-blue-500 hover:text-blue-700 underline"
                                   >
                                      View
                                   </a>
                                </td>
                             </tr>
                          ))
                      )}
                    </tbody>
                  </table>
                </div>
             </div>
          )}

          {/* System Status Footer */}
          <div className="mt-8 pt-6 border-t border-gray-200">
            <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">
              System Status
            </h4>
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-green-700">
                <span className="w-2 h-2 rounded-full bg-green-500"></span>
                Inco Network Active
              </div>
              <div className="flex items-center gap-2 text-sm text-green-700">
                <span className="w-2 h-2 rounded-full bg-green-500"></span>
                Client-side Encryption On
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
