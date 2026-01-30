
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import fs from "fs";
import path from "path";

// Load IDL
const idlPath = path.resolve(__dirname, "../target/idl/confpay.json");
const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));

const PROGRAM_ID = new PublicKey("2jgX4kX6V2YxKEHV9Vh2njRHYHwWPrTKuHd8MEHT7fYw");

async function main() {
  console.log("🚀 Starting E2E Verification...");

  // 1. Setup Connection and Provider
  const connection = new Connection("http://127.0.0.1:8899", "confirmed");
  
  const employer = Keypair.generate();
  const wallet = new anchor.Wallet(employer);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    preflightCommitment: "confirmed",
  });
  anchor.setProvider(provider);

  // @ts-ignore
  const program = new Program(idl, provider) as any;

  // 2. Airdrop SOL
  console.log(`💸 Airdropping SOL to Employer: ${employer.publicKey.toBase58()}`);
  const airdropSig = await connection.requestAirdrop(employer.publicKey, 2 * LAMPORTS_PER_SOL);
  await connection.confirmTransaction(airdropSig);
  console.log("✅ Airdrop Complete");

  // 3. Initialize Payroll
  console.log("⚙️ Initializing Payroll...");
  
  const [payrollPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("payroll"), employer.publicKey.toBuffer()],
    PROGRAM_ID
  );
  console.log("  Payroll PDA:", payrollPDA.toBase58());

  try {
    await program.methods
      .initializePayroll()
      .accounts({
        payroll: payrollPDA,
        admin: employer.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
    console.log("✅ Payroll Initialized On-Chain");
  } catch (e) {
    console.error("❌ Payroll Initialization Failed:", e);
    process.exit(1);
  }

  // 4. Verify Payroll Account
  const payrollAccount = await program.account.payroll.fetch(payrollPDA);
  console.log("  Payroll State:", payrollAccount);
  if (payrollAccount.admin.toBase58() !== employer.publicKey.toBase58()) {
    throw new Error("Admin mismatch");
  }

  // 5. Add Employee
  console.log("👤 Adding Employee...");
  const employeeWallet = Keypair.generate();
  const role = "Software Engineer";
  const salary = 5000;
  const pin = "1234";
  
  // Encrypt Salary (Simple XOR Simulation as per app logic)
  // Replicating logic from app/lib/inco.ts
  const salaryBig = BigInt(salary);
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setBigUint64(0, salaryBig, true);
  const salaryBytes = new Uint8Array(buffer);
  const keyBytes = employeeWallet.publicKey.toBuffer();
  const encryptedSalary = new Uint8Array(8);
  for (let i = 0; i < 8; i++) {
    encryptedSalary[i] = salaryBytes[i] ^ keyBytes[i % 32];
  }

  const [employeePDA] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("employee"),
      payrollPDA.toBuffer(),
      employeeWallet.publicKey.toBuffer()
    ],
    PROGRAM_ID
  );
  console.log("  Employee PDA:", employeePDA.toBase58());

  try {
    await program.methods
      .addEmployee(role, Array.from(encryptedSalary))
      .accounts({
        payroll: payrollPDA,
        employee: employeePDA,
        employeeWallet: employeeWallet.publicKey,
        admin: employer.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
    console.log("✅ Employee Added On-Chain");
  } catch (e) {
    console.error("❌ Add Employee Failed:", e);
    process.exit(1);
  }

  // 6. Verify Employee Account
  const employeeAccount = await program.account.employee.fetch(employeePDA);
  console.log("  Employee State:", employeeAccount);
  
  if (employeeAccount.role !== role) throw new Error("Role mismatch");
  
  // Decrypt Salary
  const fetchedEncrypted = new Uint8Array(employeeAccount.encryptedSalary);
  const decrypted = new Uint8Array(8);
  for (let i = 0; i < 8; i++) {
    decrypted[i] = fetchedEncrypted[i] ^ keyBytes[i % 32];
  }
  const decryptedView = new DataView(decrypted.buffer);
  const decryptedSalary = Number(decryptedView.getBigUint64(0, true));

  console.log(`  Decrypted Salary: ${decryptedSalary}`);
  if (decryptedSalary !== salary) throw new Error(`Salary mismatch: expected ${salary}, got ${decryptedSalary}`);

  console.log("🎉 E2E Verification SUCCESS!");
}

main().catch(console.error);
