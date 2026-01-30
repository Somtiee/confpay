"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import dynamic from "next/dynamic";
const WalletMultiButton = dynamic(
  async () => (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false }
);
import { PublicKey } from "@solana/web3.js";
import { fetchEmployeeData, EmployeeData } from "../lib/fetchEmployee";
import { fetchPaymentHistory, PaymentRecord } from "../lib/payment";
import { decryptSalary } from "../lib/inco";
import { PROGRAM_ID, checkCompanyRegistration } from "../lib/solana";
import { useRpc } from "../providers";

export default function WorkerDashboard() {
  const { publicKey, wallet, signMessage } = useWallet();
  const { connection } = useConnection();
  const { switchEndpoint } = useRpc();

  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [companyCode, setCompanyCode] = useState(""); // This is the Employer's Public Key
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [paymentHistory, setPaymentHistory] = useState<PaymentRecord[]>([]);
  const [employeeData, setEmployeeData] = useState<EmployeeData | null>(null);
  const [workerName, setWorkerName] = useState("");
  const [salaryDetails, setSalaryDetails] = useState<{ amount: string; schedule: string; nextPayment: number } | null>(null);

  const isConnected = !!publicKey && !!wallet;

  // Theme Toggle
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

  // Force session invalidation on wallet change or disconnect
  useEffect(() => {
    if (isLoggedIn) {
      // Case 1: Wallet disconnected
      if (!publicKey) {
        setIsLoggedIn(false);
        setEmployeeData(null);
        setSalaryDetails(null);
        setWorkerName("");
        setPaymentHistory([]);
        return;
      }

      // Case 2: Wallet switched (address mismatch)
      // We check against the wallet address that was used to authenticate
      if (employeeData?.wallet && publicKey.toBase58() !== employeeData.wallet.toBase58()) {
         setIsLoggedIn(false);
         setEmployeeData(null);
         setSalaryDetails(null);
         setWorkerName("");
         setPaymentHistory([]);
         alert("Wallet changed. Session invalidated.");
      }
    }
  }, [publicKey, isLoggedIn, employeeData]);

  // Function to refresh all data
  const refreshData = async () => {
    if (!publicKey || !companyCode) return;
    
    setHistoryLoading(true);
    try {
        // 1. Refresh History
        const history = await fetchPaymentHistory(connection, publicKey.toBase58(), false, [companyCode]);
        setPaymentHistory(history);

        // 2. Refresh Employee Data (Schedule, Next Payment, Salary)
        const onChainData = await fetchEmployeeData(
            wallet?.adapter as any,
            companyCode,
            publicKey.toBase58()
        );

        if (onChainData) {
             setEmployeeData(onChainData);
             // Recalculate derived details
             let nextTs = 0;
             try {
                 const val = onChainData.nextPaymentTs;
                 if (typeof val === 'number') nextTs = val;
                 else if (val && typeof val.toNumber === 'function') nextTs = val.toNumber();
                 else nextTs = Number(val);
             } catch (e) { nextTs = 0; }

             // Preserve decrypted salary if available, else check storage
             let currentAmount = salaryDetails?.amount || "Confidential";
             if (currentAmount === "Confidential") {
                  // Try to decrypt with existing PIN if possible? 
                  // We don't have PIN in state securely enough to auto-decrypt without prompt?
                  // Actually we have `pin` state from login form!
                  if (pin) {
                      try {
                          const result = await decryptSalary(onChainData.encryptedSalary, {
                               publicKey,
                               signMessage: signMessage!
                          }, pin);
                          if (result !== null && result > 0) currentAmount = result.toString();
                      } catch (e) {}
                  }
             }

             setSalaryDetails({
                amount: currentAmount,
                schedule: onChainData.schedule || "Weekly",
                nextPayment: nextTs > 1000000 
                    ? (nextTs > 100000000000 ? nextTs : nextTs * 1000) 
                    : Date.now()
             });
        }

    } catch (e) {
        console.error("Refresh failed", e);
    } finally {
        setHistoryLoading(false);
    }
  };

  // Auto-fetch history on login
  useEffect(() => {
    if (isLoggedIn && publicKey) {
       refreshData();
    }
  }, [isLoggedIn, publicKey, companyCode, connection]);

  const handleDecryptRetry = async () => {
    if (!employeeData || !publicKey || !signMessage) return;
    
    try {
        console.log("Retrying decryption...");
        const result = await decryptSalary(employeeData.encryptedSalary, {
           publicKey,
           signMessage
        }, pin);
        let val = result !== null ? result : 0;
        
        // Fallback
        if (val === 0) {
             const stored = localStorage.getItem(`confpay_salary_${publicKey.toBase58()}`);
             if (stored) val = parseFloat(stored);
        }

        if (val > 0) {
            setSalaryDetails(prev => prev ? ({
                ...prev,
                amount: val.toString()
            }) : null);
        }
    } catch (e) {
        console.error("Retry decryption failed", e);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isConnected) {
      alert("Please connect your wallet first");
      return;
    }

    const code = companyCode.trim();
    const userPin = pin.trim();

    if (!code || !userPin) {
      alert("Please enter Company Code and PIN");
      return;
    }

    // Direct Address Validation
    try {
       new PublicKey(code);
    } catch (e) {
       alert("❌ Invalid Company Code. Please use the Employer's Wallet Address.");
       return;
    }

    try {
      setLoading(true);
      console.log("Authenticating worker:", publicKey.toBase58());

      // 1. Verify Company Initialization (On-Chain)
      // We must ensure the company exists on-chain before attempting login
      let companyExists = false;
      try {
        companyExists = await checkCompanyRegistration(connection, new PublicKey(code));
      } catch (e: any) {
        console.error("Failed to fetch company account", e);
        const msg = e.message || JSON.stringify(e);
        if (msg.includes("403") || msg.includes("429") || msg.includes("Access forbidden")) {
            alert("⚠️ Connection busy. Switching nodes and retrying... Please try Access Dashboard again.");
            switchEndpoint();
        } else {
            alert("Network error: Failed to check company status.");
        }
        return;
      }

      if (!companyExists) {
         alert("Company not initialized");
         return;
      }

      // 2. Authenticate On-Chain (Primary Source)
      // Logic: Fetch worker PDA where companyCode == input AND address == connected
      let onChainData = null;
      try {
          onChainData = await fetchEmployeeData(
            wallet.adapter,
            code,
            publicKey.toBase58(),
            connection
          );
      } catch (err) {
          console.error("On-chain fetch failed:", err);
          alert("Network error: Failed to fetch worker record.");
          return;
      }

      if (!onChainData) {
          alert("❌ Worker not found. Please ensure you are registered with this Company Code and Wallet.");
          return;
      }

      // 3. Verify PIN
      if (onChainData.pin !== userPin) {
          alert("❌ Invalid PIN. Please check the PIN provided by your employer.");
          return;
      }
      
      console.log("Wallet & PIN Authenticated:", publicKey.toBase58());

      // 4. Set Session Data
      // Decrypt Salary using Inco Lightning
      let decryptedAmount = 0;
      try {
         const result = await decryptSalary(onChainData.encryptedSalary, {
           publicKey: publicKey!,
           signMessage: signMessage!
         }, userPin);
         decryptedAmount = result !== null ? result : 0;
         console.log("Decrypted Salary:", decryptedAmount);
      } catch (e) {
         console.error("Decryption failed", e);
         // Don't block login, just show 0 or error
      }

      // Fallback to Local Storage (Useful for demo/same-browser testing)
      if (decryptedAmount === 0) {
         const stored = localStorage.getItem(`confpay_salary_${publicKey!.toBase58()}`);
         if (stored) {
             decryptedAmount = parseFloat(stored);
             console.log("Recovered salary from storage:", decryptedAmount);
         }
      }

      setEmployeeData(onChainData);
      setWorkerName(onChainData.name || onChainData.role); 
      
      let nextTs = 0;
      try {
          // Handle BN or number
          const val = onChainData.nextPaymentTs;
          if (typeof val === 'number') nextTs = val;
          else if (val && typeof val.toNumber === 'function') nextTs = val.toNumber();
          else nextTs = Number(val);
      } catch (e) {
          console.warn("Failed to convert nextPaymentTs", e);
          nextTs = 0;
      }

      setSalaryDetails({
        amount: decryptedAmount > 0 ? decryptedAmount.toString() : "Confidential",
        schedule: onChainData.schedule || "Weekly", 
        nextPayment: nextTs > 1000000 
            ? (nextTs > 100000000000 ? nextTs : nextTs * 1000) 
            : Date.now()
      });
      
      setIsLoggedIn(true);

    } catch (error) {
      console.error("Login failed:", error);
      alert("❌ Login Error: " + (error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  if (!isLoggedIn) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-gray-50 animate-fade-in">
        <div className="card w-full max-w-md animate-slide-up">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-gray-900 mb-2">
              Worker Portal
            </h1>
            <p className="text-gray-600">Connect wallet & enter credentials</p>
          </div>

          <div className="flex justify-center mb-6">
            <WalletMultiButton />
          </div>

          <form onSubmit={handleLogin} className="space-y-6">
            <div className="bg-blue-50 p-4 rounded-lg text-sm text-blue-700 mb-6">
               <strong>New User?</strong> Contact your employer to get the Company Code and your PIN.
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Company Code (Employer Address)
              </label>
              <input
                type="text"
                required
                value={companyCode}
                onChange={(e) => setCompanyCode(e.target.value)}
                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                placeholder="Paste Employer Public Key"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Employee PIN
              </label>
              <input
                type="password"
                required
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                placeholder="Any PIN (Simulation)"
              />
            </div>

            <button
              type="submit"
              disabled={loading || !isConnected}
              className="btn-primary w-full"
              style={{ opacity: loading || !isConnected ? 0.6 : 1 }}
            >
              {loading ? "Verifying..." : "Access Dashboard"}
            </button>
          </form>

          <div className="mt-6 text-center">
            <Link
              href="/"
              className="text-sm text-blue-600 hover:text-blue-800"
            >
              ← Back to Home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-8 animate-fade-in">
      <header className="flex justify-between items-center mb-8 md:mb-12">
        <div className="flex items-center gap-4">
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
          <h1 className="text-xl md:text-2xl font-bold text-gray-900 neon-title">
            My Payments
          </h1>
        </div>
        <div className="flex items-center gap-2 md:gap-4">
          <button
            onClick={() => setIsLoggedIn(false)}
            className="text-sm text-gray-500 hover:text-gray-900 transition-colors hidden md:block"
          >
            Logout
          </button>
          <span className="text-sm text-gray-500 hidden md:block">
            {publicKey?.toBase58().slice(0, 4)}...
            {publicKey?.toBase58().slice(-4)}
          </span>
          <button
            onClick={toggleTheme}
            className="p-2 rounded-full bg-gray-100 hover:bg-gray-200 transition-colors text-xl mr-2"
            title="Toggle Theme"
          >
            🌓
          </button>
          <WalletMultiButton />
        </div>
      </header>

      <div className="max-w-4xl mx-auto space-y-6 animate-slide-up">
        {/* Employee Info Card */}
        <div className="card bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-100">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">
                {workerName || "Worker"}
              </h2>
              <p className="text-blue-600 font-medium">{employeeData?.role}</p>
            </div>
            <div className="text-right">
              <div className="text-xs text-gray-500 mb-1">Company Code</div>
              <div className="font-mono text-xs bg-white px-3 py-1.5 rounded-full border border-gray-200 shadow-sm">
                {employeeData?.payroll.toBase58().slice(0, 8)}...
              </div>
            </div>
          </div>
        </div>

        {/* Status Card */}
        <div className="card bg-green-50 border border-green-100">
          <div className="flex justify-between items-start">
            <div>
              <h2 className="text-lg font-semibold text-green-900 mb-1">
                Payroll Status: Active
              </h2>
              <p className="text-green-700">
                You are successfully authenticated with the company roster.
              </p>
            </div>
            <div className="bg-white px-3 py-1 rounded-full text-sm font-medium text-green-700 shadow-sm">
              Verified
            </div>
          </div>
        </div>

        {/* Salary Details Card */}
        {salaryDetails && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="card bg-white border border-gray-100 p-6">
               <h3 className="text-sm font-medium text-gray-500 mb-1">Salary Amount</h3>
               <div className="text-2xl font-bold text-gray-900 flex flex-col items-start">
                  {salaryDetails.amount === "Confidential" 
                    ? (
                        <>
                            <span className="text-gray-500 italic">Confidential</span>
                            <button 
                                onClick={handleDecryptRetry}
                                className="text-xs text-blue-500 hover:text-blue-700 underline mt-1 font-normal"
                            >
                                Reveal (Decrypt)
                            </button>
                        </>
                    )
                    : `${parseFloat(salaryDetails.amount).toFixed(2)} SOL`
                  }
               </div>
               <div className="text-xs text-gray-400 mt-1">per payment</div>
            </div>
            <div className="card bg-white border border-gray-100 p-6">
               <h3 className="text-sm font-medium text-gray-500 mb-1">Payment Schedule</h3>
               <div className="text-2xl font-bold text-gray-900">
                  {salaryDetails.schedule}
               </div>
               <div className="text-xs text-gray-400 mt-1">frequency</div>
            </div>
            <div className="card bg-white border border-gray-100 p-6">
               <h3 className="text-sm font-medium text-gray-500 mb-1">Next Payment</h3>
               <div className="text-2xl font-bold text-blue-600">
                  {new Date(salaryDetails.nextPayment).toLocaleDateString()}
               </div>
               <div className="text-xs text-gray-400 mt-1">expected date</div>
            </div>
          </div>
        )}

        {/* Payment History */}
        <div className="card">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-semibold">Payment History</h2>
            <button
              onClick={() => {
                if (publicKey) {
                  refreshData();
                }
              }}
              className="text-sm text-blue-600 hover:text-blue-800"
              disabled={historyLoading}
            >
              {historyLoading ? "Refreshing..." : "Refresh"}
            </button>
          </div>

          {historyLoading && paymentHistory.length === 0 ? (
            <div className="text-center py-8 text-gray-400">
              Loading history...
            </div>
          ) : paymentHistory.length === 0 ? (
            <div className="text-center py-8 text-gray-400">
              No payment history found yet.
            </div>
          ) : (
            <div className="space-y-4">
              {paymentHistory.map((payment) => (
                <div
                  key={payment.signature}
                  className="flex justify-between items-center p-4 bg-gray-50 rounded-lg border border-gray-100 hover:border-blue-200 transition-colors"
                >
                  <div>
                    <div className="font-medium text-gray-900">
                      Salary Payment
                    </div>
                    <div className="text-xs text-gray-500">
                      {new Date(payment.timestamp).toLocaleDateString()}{" "}
                      •{" "}
                      {new Date(payment.timestamp).toLocaleTimeString()}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-green-600">
                      +{payment.amount.toFixed(4)} SOL
                    </div>
                    <a
                      href={`https://explorer.solana.com/tx/${payment.signature}?cluster=devnet`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-500 hover:underline"
                    >
                      View on Chain ↗
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}