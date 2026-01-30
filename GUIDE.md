# ConfPay On-Chain & Usage Guide

This guide explains the on-chain functionality and user workflows for ConfPay, a privacy-preserving payroll system on Solana using Inco Lightning for encryption.

## 1. System Overview

ConfPay uses a hybrid approach:
- **Solana (Devnet)**: Stores program state, manages PDAs (Program Derived Addresses), and handles SOL payments.
- **Inco Network (Devnet)**: Provides confidentiality via TEE (Trusted Execution Environment). Salaries are encrypted using Inco's KMS and can only be decrypted by authorized users (Employer and the specific Worker).

## 2. Employer Dashboard Workflow

### Initialization
- When you first connect your wallet, the app checks if a `Payroll PDA` exists for your address.
- If not, you are redirected to the Signup page.
- **On-Chain Action**: `initialize_payroll` instruction creates a Payroll account owned by your wallet.

### Adding Employees
1.  **Input**: You provide Name, Role, Wallet Address, Salary (in SOL), PIN, and Schedule.
2.  **Encryption**: The app generates a temporary keypair, encrypts the salary using `@inco/solana-sdk` (targeting Inco's KMS), and discards the keypair. The result is a `ciphertext` (encrypted data) and `input_type` (u64).
3.  **On-Chain Action**: `add_employee` instruction is called. It creates an `Employee PDA` derived from `[b"employee", payroll_pda, employee_wallet]`.
4.  **Storage**: The `ciphertext` is stored on-chain in the Employee PDA. The salary is **never** visible in plaintext on the blockchain.

### Decrypting Salaries (Attested Decryption)
- By default, salaries are shown as "Confidential".
- Click the **"Decrypt Salaries"** button (Eye icon).
- **Signature Request**: Your wallet will ask you to sign a message. This signature proves you are the owner of the wallet.
- **Verification**: The signature is sent to Inco's validators. If valid, they return the decrypted value (plaintext).
- **Display**: The app updates the UI with the real numbers. This happens entirely client-side; plaintext is never saved to the chain.

### Payments & Autobot
- **Manual Payment**: Click "Pay" next to an employee. Sends a standard SOL transfer.
- **Autobot**:
    1.  Click the "Robot" icon in the header.
    2.  **Setup**: Generates a local Keypair (stored in your browser's `localStorage`).
    3.  **Funding**: You must send ~0.1 SOL to the Bot's address (displayed in the modal) to cover gas fees and payments.
    4.  **Activation**: Toggle "Enable Auto-Pay".
    5.  **Loop**: The bot runs every minute. It checks:
        - Is the current time >= `nextPaymentDate`?
        - Has a payment been made recently (safety check)?
    6.  **Execution**: If due, the Bot signs a transaction to transfer SOL from its wallet to the employee. It then calls `pay_employee` on-chain to update the `last_paid_ts` and advance the `nextPaymentDate`.

### Removing Employees
- Click the Trash icon.
- **On-Chain Action**: `remove_employee` instruction closes the Employee PDA and refunds the rent (SOL) to your wallet.

## 3. Worker Portal Workflow

### Login
- **Strict Authentication**: Workers must provide:
    1.  **Company Code**: The Employer's Wallet Address.
    2.  **Wallet Connection**: Must match the address registered by the employer.
    3.  **PIN**: Must match the PIN set by the employer.
- The app verifies the Employee PDA exists on-chain before allowing access.

### Viewing Salary
- Upon login, the salary is encrypted.
- The app automatically attempts **Attested Decryption** (asking for a signature).
- If successful, the worker sees their salary.
- **Privacy**: Workers can ONLY decrypt their own salary. They cannot see other workers' data.

## 4. Technical Details

- **Program ID**: `DMfwsji9dYMGDjNiWjdZiRnUYCbEMTMwXRhgxRYkarUK`
- **Network**: Solana Devnet + Inco Devnet
- **Encryption Standard**: Inco Lightning (AES-GCM backed by TEE).
- **Dependencies**: `@inco/solana-sdk`, `@coral-xyz/anchor`, `@solana/web3.js`.

## 5. Troubleshooting

- **"Account does not exist"**: Ensure you are using the correct Company Code (Employer Address).
- **"Decryption failed"**: Ensure your wallet supports message signing and you are connected to the internet.
- **"RPC Rate Limit"**: If transactions fail, wait a few seconds. The app has built-in retry logic.
- **Autobot not paying**: Check if the Bot wallet has enough SOL. The Bot cannot pay if its balance is low.
