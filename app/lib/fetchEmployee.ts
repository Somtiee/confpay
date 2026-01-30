import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { Buffer } from "buffer";
import idl from "../idl/confpay.json";
import { getProvider, PROGRAM_ID } from "./anchor";
import { IS_MOCK_MODE, MOCK_STORAGE_PREFIX } from "./solana";

export interface EmployeeData {
  payroll: PublicKey;
  wallet: PublicKey;
  name: string;
  role: string;
  encryptedSalary: number[]; // Vec<u8>
  inputType: number; // u8
  pin: string;
  schedule: string;
  nextPaymentTs: anchor.BN;
  lastPaidTs: anchor.BN;
}

// Helper to decode Legacy Employee (pre-timestamp fields)
function decodeLegacyEmployee(buffer: Buffer | Uint8Array): EmployeeData {
    const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    let offset = 8; // Skip discriminator

    const payroll = new PublicKey(data.subarray(offset, offset + 32));
    offset += 32;

    const wallet = new PublicKey(data.subarray(offset, offset + 32));
    offset += 32;

    const readString = () => {
        if (offset + 4 > data.length) return "";
        const len = data.readUInt32LE(offset);
        offset += 4;
        if (offset + len > data.length) return "";
        const str = data.subarray(offset, offset + len).toString('utf8');
        offset += len;
        return str;
    };

    const name = readString();
    const role = readString();
    const pin = readString();
    const schedule = readString();

    // Try reading Encrypted Salary HERE (Correct Rust Struct Order)
    let encryptedSalary: number[] = [];
    
    // Heuristic: Check if next 4 bytes look like a reasonable length for Vec<u8>
    if (offset + 4 <= data.length) {
        const potentialLen = data.readUInt32LE(offset);
        if (potentialLen < 1024) { // Reasonable sanity check
             offset += 4;
             if (offset + potentialLen <= data.length) {
                 encryptedSalary = Array.from(data.subarray(offset, offset + potentialLen));
                 offset += potentialLen;
             }
        }
    }

    // Read input_type (u8) - Critical for alignment
    let inputType = 4; // Default to 4 (u64)
    if (offset + 1 <= data.length) {
        inputType = data.readUInt8(offset);
        offset += 1;
    }

    let nextPaymentTs = new anchor.BN(0);
    let lastPaidTs = new anchor.BN(0);

    // Try to read timestamps if data remains
    // 8 bytes (i64) + 8 bytes (i64) = 16 bytes
    if (offset + 16 <= data.length) {
        try {
            nextPaymentTs = new anchor.BN(data.readBigInt64LE(offset).toString());
            offset += 8;
            lastPaidTs = new anchor.BN(data.readBigInt64LE(offset).toString());
            offset += 8;
        } catch (e) {
            console.log("Could not read timestamps, defaulting to 0");
        }
    }

    return {
        payroll,
        wallet,
        name,
        role,
        encryptedSalary,
        inputType,
        pin,
        schedule,
        nextPaymentTs,
        lastPaidTs
    };
}

export async function fetchEmployeeData(
  wallet: any,
  employerAddress: string, // The Company Code (Employer Wallet)
  employeeWallet: string,
  connection?: any // Optional connection override
): Promise<EmployeeData | null> {
  try {
    // Basic validation before Anchor involvement
    if (!employerAddress || !employeeWallet) return null;

    const provider = getProvider(wallet, connection);
    anchor.setProvider(provider);

    // Wrap Program init in try-catch because IDL parsing can throw _bn errors
    // if there are version mismatches or invalid types
    // Ensure IDL has the program address
    const idlWithAddress = {
      ...idl,
      address: PROGRAM_ID.toBase58(),
      events: [], // CRITICAL FIX: Strip events
    };
    
    const program = new anchor.Program(idlWithAddress as anchor.Idl, provider);

    // 1. Derive Payroll PDA (from Employer Address)
    const [payrollPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("payroll"), new PublicKey(employerAddress).toBuffer()],
      PROGRAM_ID
    );

    // 2. Derive Employee PDA (from Payroll PDA + Employee Wallet)
    const [employeePDA] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("employee"),
        payrollPDA.toBuffer(),
        new PublicKey(employeeWallet).toBuffer()
      ],
      PROGRAM_ID
    );
    
    console.log("Fetching Employee PDA:", employeePDA.toBase58(), "for Payroll:", payrollPDA.toBase58());

    if (IS_MOCK_MODE) {
      console.log("⚠️ [MOCK MODE] Fetching Employee Data");
      await new Promise(r => setTimeout(r, 500)); // Simulate network delay
      
      const mockDataStr = localStorage.getItem(MOCK_STORAGE_PREFIX + employeePDA.toBase58());
      if (mockDataStr) {
        console.log("✅ [MOCK MODE] Employee Found:", mockDataStr);
        return JSON.parse(mockDataStr) as EmployeeData;
      }
      console.log("❌ [MOCK MODE] Employee Not Found");
      return null;
    }

    let retries = 3;
    let delay = 1000;
    while (retries > 0) {
        try {
            // @ts-ignore
            const account: any = await program.account.employee.fetch(employeePDA);
            const normalized: EmployeeData = {
                payroll: account.payroll,
                wallet: account.wallet,
                name: account.name,
                role: account.role,
                encryptedSalary: Array.isArray(account.ciphertext) ? account.ciphertext : 
                                 (Buffer.isBuffer(account.ciphertext) ? Array.from(account.ciphertext) : 
                                 (account.ciphertext instanceof Uint8Array ? Array.from(account.ciphertext) : 
                                 (account.encryptedSalary || account.encrypted_salary || []))),
                inputType: account.input_type ?? account.inputType ?? 4,
                pin: account.pin,
                schedule: account.schedule,
                nextPaymentTs: new anchor.BN(account.next_payment_ts ?? account.nextPaymentTs ?? 0),
                lastPaidTs: new anchor.BN(account.last_paid_ts ?? account.lastPaidTs ?? 0),
            };
            return normalized;
        } catch (fetchErr: any) {
             const msg = fetchErr.message || JSON.stringify(fetchErr);
             if (msg.includes("403") || msg.includes("429") || msg.includes("Access forbidden") || msg.includes("fetch failed") || msg.includes("CORS")) {
                  console.warn(`[fetchEmployeeData] Network Limit (${msg}). Retrying in ${delay}ms... (${retries} left)`);
                  retries--;
                  if (retries === 0) return null;
                  await new Promise(r => setTimeout(r, delay));
                  delay *= 1.5;
                  continue;
             }

            console.warn("Standard fetch failed (possible legacy account), trying manual decode...", fetchErr);
            // Fallback: Fetch raw account info and try legacy decode
            try {
                const accountInfo = await provider.connection.getAccountInfo(employeePDA);
                if (accountInfo) {
                    try {
                        return decodeLegacyEmployee(accountInfo.data);
                    } catch (decodeErr) {
                        console.error("Legacy decode failed:", decodeErr);
                    }
                }
            } catch (rawErr: any) {
                // If even raw fetch fails with network error, retry
                const rawMsg = rawErr.message || JSON.stringify(rawErr);
                if (rawMsg.includes("403") || rawMsg.includes("429") || rawMsg.includes("Access forbidden") || rawMsg.includes("fetch failed") || rawMsg.includes("CORS")) {
                    console.warn(`[fetchEmployeeData-Raw] Network Limit (${rawMsg}). Retrying in ${delay}ms... (${retries} left)`);
                    retries--;
                    if (retries === 0) return null;
                    await new Promise(r => setTimeout(r, delay));
                    delay *= 1.5;
                    continue;
                }
            }
            // If it wasn't a network error but a logic error (e.g. Account Not Found), break and return null
            throw fetchErr;
        }
    }
    return null;
  } catch (err) {
    console.error("Error fetching employee account (On-Chain):", err);
    // Return null to allow fallback to LocalStorage
    return null;
  }
}

export async function fetchAllEmployees(
  wallet: any,
  employerAddress: string,
  connection?: any // Optional connection override
): Promise<EmployeeData[]> {
    if (!employerAddress) return [];
    
    try {
        // Use provided connection or default to getProvider (which hardcodes devnet)
        let provider;
        if (connection) {
            provider = new anchor.AnchorProvider(connection, wallet, {
                preflightCommitment: "confirmed",
            });
        } else {
            provider = getProvider(wallet);
        }
        
        // Deep clone IDL and strip events to prevent errors
        const idlClone = { ...idl, address: PROGRAM_ID.toBase58(), events: [] };
        const program = new anchor.Program(idlClone as anchor.Idl, provider);

        const [payrollPDA] = PublicKey.findProgramAddressSync(
          [Buffer.from("payroll"), new PublicKey(employerAddress).toBuffer()],
          PROGRAM_ID
        );
        
        console.log("[fetchAllEmployees] Fetching for Payroll:", payrollPDA.toBase58());

        // We remove the strict discriminator filter to ensure we catch all accounts (Legacy & Modern)
        // that belong to this payroll. The payroll PDA is at offset 8 (after 8-byte discriminator).
        
        let accounts: any[] = [];
        let retries = 3;
        let delay = 2000;

        while (retries > 0) {
            try {
                accounts = await provider.connection.getProgramAccounts(PROGRAM_ID, {
                    filters: [
                        {
                            memcmp: {
                                offset: 8, // After discriminator (8 bytes), looking for payroll PDA
                                bytes: payrollPDA.toBase58(),
                            },
                        },
                    ],
                });
                break; // Success
            } catch (e: any) {
                const msg = e.message || JSON.stringify(e);
                console.warn(`[fetchAllEmployees] Fetch failed (${msg}). Retrying in ${delay}ms...`);
                retries--;
                if (retries === 0) throw e;
                await new Promise(r => setTimeout(r, delay));
                delay *= 1.5;
            }
        }
        
        console.log("[fetchAllEmployees] Found accounts:", accounts.length);

        return accounts.map(acc => {
            try {
                // Try decoding with standard Coder
                try {
                    const account = program.coder.accounts.decode("Employee", acc.account.data);
                    return normalizeEmployeeData(account);
                } catch (firstErr) {
                     // Fallback for case sensitivity or legacy IDL
                     try {
                        // @ts-ignore
                        const account = program.coder.accounts.decode("employee", acc.account.data);
                        return normalizeEmployeeData(account);
                     } catch (secondErr) {
                         // Fallback for LEGACY accounts (pre-timestamp or layout mismatch)
                         // console.warn("Standard decode failed, trying legacy decode...", secondErr);
                         return decodeLegacyEmployee(acc.account.data);
                     }
                }
            } catch (e) {
                console.error("Failed to decode employee account:", e);
                return null;
            }
        }).filter((e): e is EmployeeData => e !== null);
        
    } catch (err) {
        console.error("Error fetching all employees:", err);
        return [];
    }
}

// Helper to normalize data from Anchor decoder
function normalizeEmployeeData(account: any): EmployeeData {
    return {
        payroll: account.payroll,
        wallet: account.wallet,
        name: account.name,
        role: account.role,
        encryptedSalary: Array.isArray(account.ciphertext) ? account.ciphertext : 
                         (Buffer.isBuffer(account.ciphertext) ? Array.from(account.ciphertext) : 
                         (account.encryptedSalary || account.encrypted_salary || [])),
        inputType: account.input_type ?? account.inputType ?? 4,
        pin: account.pin,
        schedule: account.schedule,
        nextPaymentTs: new anchor.BN(account.next_payment_ts ?? account.nextPaymentTs ?? 0),
        lastPaidTs: new anchor.BN(account.last_paid_ts ?? account.lastPaidTs ?? 0),
    };
}
