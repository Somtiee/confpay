import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, SystemProgram, Keypair, Transaction, VersionedTransaction } from "@solana/web3.js";
import { Buffer } from "buffer";
import idl from "../idl/confpay.json";
import { PROGRAM_ID } from "./anchor";
export { PROGRAM_ID };

export const IS_MOCK_MODE = false;

// Simple Wallet implementation for Bot (Keypair) to avoid Node-only dependencies
export class BotWallet implements anchor.Wallet {
  constructor(readonly payer: Keypair) {}
  async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
    if (tx instanceof Transaction) {
      tx.partialSign(this.payer);
    } else {
      tx.sign([this.payer]);
    }
    return tx;
  }
  async signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> {
    return txs.map((t) => {
      if (t instanceof Transaction) {
        t.partialSign(this.payer);
      } else {
        t.sign([this.payer]);
      }
      return t;
    });
  }
  get publicKey(): PublicKey {
    return this.payer.publicKey;
  }
}
export const MOCK_STORAGE_PREFIX = "confpay_mock_";

// --- Helper for Mock Mode ---
const getMockData = (key: string) => {
    const data = localStorage.getItem(MOCK_STORAGE_PREFIX + key);
    return data ? JSON.parse(data) : null;
};

const setMockData = (key: string, value: any) => {
    localStorage.setItem(MOCK_STORAGE_PREFIX + key, JSON.stringify(value));
};

export async function checkCompanyRegistration(connection: Connection, walletPublicKey: PublicKey) {
    let retries = 3;
    let delay = 1000;
    while (retries > 0) {
        try {
            const [payrollPDA] = PublicKey.findProgramAddressSync(
                [new TextEncoder().encode("payroll"), walletPublicKey.toBuffer()],
                PROGRAM_ID
            );
            const accountInfo = await connection.getAccountInfo(payrollPDA);
            return accountInfo !== null;
        } catch (error: any) {
            console.error(`Error checking registration (attempts left: ${retries}):`, error);
            const msg = error.message || JSON.stringify(error);
            if (msg.includes("403") || msg.includes("429") || msg.includes("fetch failed") || msg.includes("CORS")) {
                 retries--;
                 if (retries === 0) throw error;
                 await new Promise(r => setTimeout(r, delay));
                 delay *= 1.5;
                 continue;
            }
            throw error;
        }
    }
    return false;
}

export async function fetchCompanyData(connection: Connection, walletPublicKey: PublicKey) {
    let retries = 3;
    let delay = 1000;

    while (retries > 0) {
        try {
            const [payrollPDA] = PublicKey.findProgramAddressSync(
                [new TextEncoder().encode("payroll"), walletPublicKey.toBuffer()],
                PROGRAM_ID
            );

            // Create a read-only provider
            const provider = new anchor.AnchorProvider(
                connection,
                {
                    publicKey: walletPublicKey,
                    signTransaction: () => Promise.reject(new Error("Read-only")),
                    signAllTransactions: () => Promise.reject(new Error("Read-only")),
                } as any,
                { preflightCommitment: "confirmed" }
            );

            // Ensure IDL has the program address
            const idlWithoutEvents = {
                ...idl,
                address: PROGRAM_ID.toBase58(),
                events: [],
            };

            const program = new anchor.Program(idlWithoutEvents as anchor.Idl, provider);
            
            try {
                const payrollAccount = await (program.account as any).payroll.fetch(payrollPDA);
                return { 
                    companyName: payrollAccount.companyName as string,
                    employeeCount: (payrollAccount.employeeCount as any).toNumber()
                };
            } catch (fetchErr: any) {
                const msg = fetchErr.message || JSON.stringify(fetchErr);
                 // Only retry on network errors, not "Account does not exist"
                if (msg.includes("403") || msg.includes("429") || msg.includes("Access forbidden") || msg.includes("fetch failed") || msg.includes("CORS")) {
                     throw fetchErr; // Re-throw to trigger retry loop
                }
                console.error("Failed to fetch payroll account (non-network):", fetchErr);
                return { companyName: "My Company" }; // Fallback only on non-network error
            }
        } catch (e: any) {
            const msg = e.message || JSON.stringify(e);
            if (msg.includes("403") || msg.includes("429") || msg.includes("Access forbidden") || msg.includes("fetch failed") || msg.includes("CORS")) {
                 console.warn(`[fetchCompanyData] Network Limit (${msg}). Retrying in ${delay}ms... (${retries} left)`);
                 retries--;
                 if (retries === 0) return null; // Return null on network failure so we don't show fake data
                 await new Promise(r => setTimeout(r, delay));
                 delay *= 1.5;
                 continue;
            }
            console.error("Error in fetchCompanyData:", e);
            return null;
        }
    }
    return null;
}

export async function initializePayroll(wallet: any, companyName: string) {
  const [payrollPDA] = PublicKey.findProgramAddressSync(
    [new TextEncoder().encode("payroll"), wallet.publicKey.toBuffer()],
    PROGRAM_ID
  );

  const connection = wallet.connection || wallet.adapter?.connection || new Connection("https://devnet.helius-rpc.com/?api-key=b0cc0944-d97f-42ea-8336-fb7e52dad8e1");
  const provider = new anchor.AnchorProvider(connection, wallet, {
      preflightCommitment: "confirmed",
  });
  
  // Ensure IDL has the program address
  const idlWithoutEvents = {
    ...idl,
    address: PROGRAM_ID.toBase58(),
    events: [],
  };

  const program = new anchor.Program(idlWithoutEvents as anchor.Idl, provider);

  const tx = await program.methods
    .initializePayroll(companyName)
    .accounts({
      payroll: payrollPDA,
      admin: wallet.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  
  return tx;
}

export async function addEmployeeTransaction(
  wallet: any,
  employerAddress: string, // The Employer's Wallet Address
  employeeWallet: string,
  name: string,
  role: string,
  ciphertext: number[], // Vec<u8>
  inputType: number,    // u8
  pin: string,
  schedule: string,
  nextPaymentDate: number
) {
  // 1. Derive Payroll PDA (from Employer Address)
  const [payrollPDA] = PublicKey.findProgramAddressSync(
    [new TextEncoder().encode("payroll"), new PublicKey(employerAddress).toBuffer()],
    PROGRAM_ID
  );

  // 2. Derive Employee PDA (from Payroll PDA + Employee Wallet)
  const [employeePDA] = PublicKey.findProgramAddressSync(
    [
      new TextEncoder().encode("employee"),
      payrollPDA.toBuffer(),
      new PublicKey(employeeWallet).toBuffer()
    ],
    PROGRAM_ID
  );

  console.log("Adding Employee Transaction:", {
    employer: employerAddress,
    payrollPDA: payrollPDA.toBase58(),
    employeePDA: employeePDA.toBase58(),
    employeeWallet: employeeWallet,
    name: name,
    pin: pin,
    schedule: schedule,
    nextPaymentDate: nextPaymentDate
  });

  const connection = wallet.connection || wallet.adapter?.connection || new Connection("https://devnet.helius-rpc.com/?api-key=b0cc0944-d97f-42ea-8336-fb7e52dad8e1");
  const provider = new anchor.AnchorProvider(connection, wallet, {
      preflightCommitment: "confirmed",
  });

  // Ensure IDL has the program address
  const idlWithoutEvents = {
    ...idl,
    address: PROGRAM_ID.toBase58(),
    events: [],
  };

  const program = new anchor.Program(idlWithoutEvents as anchor.Idl, provider);

  // Ensure proper types for IDL
  let safeCiphertext = Array.isArray(ciphertext) ? ciphertext : Array.from(ciphertext || []);
  if (safeCiphertext.length > 256) {
      console.warn("Ciphertext too long, truncating to 256 bytes");
      safeCiphertext = safeCiphertext.slice(0, 256);
  }
  const safeInputType = (typeof inputType === 'number' && inputType >= 0) ? inputType : 4;
  let safeNextPaymentTs = Math.floor(nextPaymentDate / 1000);
  if (isNaN(safeNextPaymentTs) || safeNextPaymentTs < 0) {
      safeNextPaymentTs = Math.floor(Date.now() / 1000);
  }

  // Enforce string limits to avoid Borsh serialization errors
  const safeName = name.slice(0, 50);
  const safeRole = role.slice(0, 32);
  const safePin = pin.slice(0, 10);
  const safeSchedule = schedule.slice(0, 20);

  // Debug arguments
  console.log("Add Employee Args:", {
      name: safeName, 
      role: safeRole, 
      ciphertextLen: safeCiphertext.length, 
      inputType: safeInputType, 
      pin: safePin, 
      schedule: safeSchedule, 
      nextPaymentTs: safeNextPaymentTs
  });

  const tx = await program.methods
      .addEmployee(
          safeName, 
          safeRole, 
          Buffer.from(safeCiphertext as number[]), 
          safeInputType,
          safePin,
          safeSchedule, 
          new anchor.BN(safeNextPaymentTs)
      )
    .accounts({
      payroll: payrollPDA,
      employee: employeePDA,
      employeeWallet: new PublicKey(employeeWallet),
      admin: wallet.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  
  return tx;
}

export async function updateEmployeeTransaction(
  wallet: any,
  employerAddress: string, // The Employer's Wallet Address
  employeeWallet: string,
  name: string,
  role: string,
  ciphertext: number[], 
  inputType: number,    
  pin: string,
  schedule: string,
  nextPaymentDate: number
) {
  // 1. Derive Payroll PDA (from Employer Address)
  const [payrollPDA] = PublicKey.findProgramAddressSync(
    [new TextEncoder().encode("payroll"), new PublicKey(employerAddress).toBuffer()],
    PROGRAM_ID
  );

  // 2. Derive Employee PDA (from Payroll PDA + Employee Wallet)
  const [employeePDA] = PublicKey.findProgramAddressSync(
    [
      new TextEncoder().encode("employee"),
      payrollPDA.toBuffer(),
      new PublicKey(employeeWallet).toBuffer()
    ],
    PROGRAM_ID
  );

  // Ensure proper types for IDL
  // Convert ciphertext to number[] safely
  let safeCiphertext = Array.isArray(ciphertext) ? ciphertext : Array.from(ciphertext || []);
  if (safeCiphertext.length > 256) {
      console.warn("Ciphertext too long, truncating to 256 bytes");
      safeCiphertext = safeCiphertext.slice(0, 256);
  }
  
  // Default inputType to 4 (u64) if invalid
  const safeInputType = (typeof inputType === 'number' && inputType >= 0) ? inputType : 4; 
  
  // Handle Date
  let safeNextPaymentTs = Math.floor(nextPaymentDate / 1000);
  if (isNaN(safeNextPaymentTs) || safeNextPaymentTs < 0) {
      safeNextPaymentTs = Math.floor(Date.now() / 1000);
      console.warn("Invalid nextPaymentDate detected, defaulting to Now", nextPaymentDate);
  }

  // Enforce string limits
  const safeName = name.slice(0, 50);
  const safeRole = role.slice(0, 32);
  const safePin = pin.slice(0, 10);
  const safeSchedule = schedule.slice(0, 20);

  console.log("Updating Employee Transaction:", {
    employer: employerAddress,
    payrollPDA: payrollPDA.toBase58(),
    employeePDA: employeePDA.toBase58(),
    employeeWallet: employeeWallet,
    name: safeName,
    pin: safePin,
    schedule: safeSchedule,
    nextPaymentDateRaw: nextPaymentDate,
    nextPaymentTs: safeNextPaymentTs,
    ciphertextLen: safeCiphertext.length,
    inputType: safeInputType
  });

  const connection = wallet.connection || wallet.adapter?.connection || new Connection("https://devnet.helius-rpc.com/?api-key=b0cc0944-d97f-42ea-8336-fb7e52dad8e1");
  const provider = new anchor.AnchorProvider(connection, wallet, {
      preflightCommitment: "confirmed",
  });

  // Ensure IDL has the program address
  const idlWithoutEvents = {
    ...idl,
    address: PROGRAM_ID.toBase58(),
    events: [],
  };

  const program = new anchor.Program(idlWithoutEvents as anchor.Idl, provider);

  // Retry logic for 429 errors
  let retries = 5;
  let delay = 2000;

  while (retries > 0) {
      try {
          const tx = await program.methods
            .updateEmployee(
                safeName, 
                safeRole, 
                Buffer.from(safeCiphertext as number[]),
                safeInputType,
                safePin,
                safeSchedule, 
                new anchor.BN(safeNextPaymentTs)
            )
            .accounts({
              employee: employeePDA,
              employeeWallet: new PublicKey(employeeWallet),
              payroll: payrollPDA,
              admin: wallet.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .rpc();
          
          return tx;
      } catch (error: any) {
          const msg = error.message || error.toString();
          if (msg.includes("429")) {
              console.warn(`Rate limited (429), retrying in ${delay}ms... (Retries left: ${retries})`);
              retries--;
              await new Promise(r => setTimeout(r, delay));
              delay *= 1.5;
          } else {
              console.error("Update Employee Failed:", error);
              throw error;
          }
      }
  }
  throw new Error("Max retries exceeded for updateEmployee");
}

export async function removeEmployeeTransaction(wallet: any, employerAddress: string, employeeWallet: string) {
    const [payrollPDA] = PublicKey.findProgramAddressSync(
        [new TextEncoder().encode("payroll"), new PublicKey(employerAddress).toBuffer()],
        PROGRAM_ID
    );
    const [employeePDA] = PublicKey.findProgramAddressSync(
        [new TextEncoder().encode("employee"), payrollPDA.toBuffer(), new PublicKey(employeeWallet).toBuffer()],
        PROGRAM_ID
    );

  const connection = wallet.connection || wallet.adapter?.connection || new Connection("https://devnet.helius-rpc.com/?api-key=b0cc0944-d97f-42ea-8336-fb7e52dad8e1");
  const provider = new anchor.AnchorProvider(connection, wallet, {
      preflightCommitment: "confirmed",
  });
    const idlWithoutEvents = { ...idl, address: PROGRAM_ID.toBase58(), events: [] };
    const program = new anchor.Program(idlWithoutEvents as anchor.Idl, provider);

    return await program.methods.removeEmployee()
        .accounts({
            payroll: payrollPDA,
            employee: employeePDA,
            employeeWallet: new PublicKey(employeeWallet),
            admin: wallet.publicKey,
            // systemProgram removed as it is not in the IDL for removeEmployee
        })
        .rpc();
}

export async function payEmployeeTransaction(
    wallet: any,
    employerAddress: string,
    employeeWallet: string
) {
    // This is the ON-CHAIN instruction to update "last_paid_ts"
    // It does NOT send SOL (that's done via SystemProgram.transfer in client/bot)
    // But we need to call this to keep on-chain record updated.

    const [payrollPDA] = PublicKey.findProgramAddressSync(
        [new TextEncoder().encode("payroll"), new PublicKey(employerAddress).toBuffer()],
        PROGRAM_ID
    );
    const [employeePDA] = PublicKey.findProgramAddressSync(
        [new TextEncoder().encode("employee"), payrollPDA.toBuffer(), new PublicKey(employeeWallet).toBuffer()],
        PROGRAM_ID
    );

  const connection = wallet.connection || wallet.adapter?.connection || new Connection("https://devnet.helius-rpc.com/?api-key=b0cc0944-d97f-42ea-8336-fb7e52dad8e1");
  const provider = new anchor.AnchorProvider(connection, wallet, {
      preflightCommitment: "confirmed",
  });
    const idlWithoutEvents = { ...idl, address: PROGRAM_ID.toBase58(), events: [] };
    const program = new anchor.Program(idlWithoutEvents as anchor.Idl, provider);

    return await program.methods.payEmployee()
        .accounts({
            payroll: payrollPDA,
            employee: employeePDA,
            admin: wallet.publicKey,
            systemProgram: SystemProgram.programId
        })
        .rpc();
}
