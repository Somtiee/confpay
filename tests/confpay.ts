import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Confpay } from "../target/types/confpay";
import { PublicKey } from "@solana/web3.js";

describe("confpay", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.confpay as Program<Confpay>;
  
  const admin = provider.wallet;
  const employeeWallet = anchor.web3.Keypair.generate();
  
  const [payrollPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("payroll"), admin.publicKey.toBuffer()],
    program.programId
  );

  const [employeePDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("employee"), payrollPDA.toBuffer(), employeeWallet.publicKey.toBuffer()],
    program.programId
  );

  it("Is initialized!", async () => {
    // Initialize Payroll
    try {
        const tx = await program.methods
        .initializePayroll()
        .accounts({
            payroll: payrollPDA,
            admin: admin.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
        console.log("Your transaction signature", tx);
    } catch (e) {
        console.log("Error initializing payroll:", e);
        throw e;
    }
  });

  it("Adds an employee!", async () => {
      const role = "Software Engineer";
      const encryptedSalary = Array.from(new Uint8Array([1, 2, 3, 4])); // Mock data
      const pin = "1234";

      try {
        const tx = await program.methods
        .addEmployee(role, Buffer.from(encryptedSalary), pin)
        .accounts({
            payroll: payrollPDA,
            employee: employeePDA,
            employeeWallet: employeeWallet.publicKey,
            admin: admin.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
        console.log("Add Employee Signature", tx);
      } catch (e) {
          console.log("Error adding employee:", e);
          throw e;
      }
  });
});
