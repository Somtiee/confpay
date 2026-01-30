"use client";

import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import idl from "../idl/confpay.json";
import { getProvider } from "./anchor";
import { PROGRAM_ID, IS_MOCK_MODE, MOCK_STORAGE_PREFIX } from "./solana";

export async function addEmployeeTransaction_OLD(
  wallet: any,
  employerAddress: string, // The Employer's Wallet Address
  employeeWallet: string,
  role: string,
  encryptedSalary: Uint8Array,
  pin: string
) {
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

  console.log("Adding Employee Transaction (Explicit Confirm):", {
    employer: employerAddress,
    payrollPDA: payrollPDA.toBase58(),
    employeePDA: employeePDA.toBase58(),
    employeeWallet: employeeWallet,
    pin: pin
  });

  // --- MOCK MODE ---
  if (IS_MOCK_MODE) {
      console.log("⚠️ [MOCK MODE] Adding Employee");
      await new Promise(r => setTimeout(r, 1000));
      
      const mockData = {
          payroll: payrollPDA.toBase58(),
          wallet: employeeWallet,
          role: role,
          encryptedSalary: Array.from(encryptedSalary),
          pin: pin
      };
      
      localStorage.setItem(MOCK_STORAGE_PREFIX + employeePDA.toBase58(), JSON.stringify(mockData));
      return "mock_tx_signature_" + Date.now();
  }

  const provider = getProvider(wallet);
  anchor.setProvider(provider);

  // Ensure IDL has the program address (required for newer Anchor versions)
  const idlWithAddress = {
    ...idl,
    address: PROGRAM_ID.toBase58(),
  };

  const program = new anchor.Program(idlWithAddress as anchor.Idl, provider);

  const tx = await program.methods
    .addEmployee(role, Array.from(encryptedSalary), pin)
    .accounts({
      payroll: payrollPDA,
      employee: employeePDA,
      employeeWallet: new PublicKey(employeeWallet),
      admin: provider.wallet.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .transaction();

  const signature = await provider.sendAndConfirm(tx, [], {
      commitment: "confirmed",
      preflightCommitment: "confirmed",
  });
  
  return signature;
}
