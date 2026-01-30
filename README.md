
# 🕶️ CONFPAY — Confidential Payroll on Solana

**ConfPay** is a **privacy-preserving payroll & vesting protocol** built on **Solana**, powered by **Inco Network (Fully Homomorphic Encryption)** and **client-side AES encryption**.

It enables organizations to pay salaries, manage vesting schedules, and automate payroll **fully on-chain** — **without exposing sensitive financial data** to the public blockchain.

> 💡 ConfPay solves the *Transparency Paradox*:
> Businesses want blockchain efficiency, but **cannot afford public salary disclosure**.

---

## 🔐 Why ConfPay?

On Solana today, storing a salary like:

```ts
salary: 1.5
```

means **anyone can read it**.

ConfPay changes this by making salary data:

* 🔒 **Encrypted before it ever touches the blockchain**
* 👀 **Visible only to the employer and the specific employee**
* ⚡ **Instantly decryptable at native UI speed**

No mixers.
No obfuscation hacks.
**Real data privacy.**

---

## 🧠 Core Idea

ConfPay introduces a **Dual-Encryption Architecture**:

| Layer               | Purpose                                              |
| ------------------- | ---------------------------------------------------- |
| **Inco FHE**        | On-chain compute privacy (future-proof & verifiable) |
| **Client-Side AES** | Instant, local decryption for UX                     |
| **Solana**          | Settlement, execution, and automation                |

This allows ConfPay to keep **execution public** while keeping **business logic private**.

---

## 🏗️ Architecture Overview

```
┌──────────────┐
│   Frontend   │
│  (Next.js)   │
└──────┬───────┘
       │ encryptSalary()
       ▼
┌────────────────────────────┐
│ Dual Encryption Payload    │
│ • Inco FHE Ciphertext      │
│ • AES Encrypted Value      │
└────────────┬───────────────┘
             ▼
      ┌─────────────┐
      │  Solana L1  │
      │ (Public)    │
      └─────────────┘
             ▲
             │ decrypt locally
┌────────────┴─────────────┐
│ Employer / Worker Wallet │
└──────────────────────────┘
```

---

## 🧬 Tech Stack

* **Blockchain:** Solana (Devnet)
* **Privacy Layer:** Inco Network (FHE)
* **Frontend:** Next.js + React
* **Wallets:** Phantom Wallet
* **Encryption:**

  * Fully Homomorphic Encryption (Inco)
  * AES (Client-Side)
* **Automation:** Clockwork Bot (prototype)
* **RPC:** Public + fallback routing (Helius-compatible)

---

## ✨ Key Features

### 🏢 Employer

* Initialize an on-chain organization
* Add employees with **encrypted salaries**
* Edit roles, schedules, and compensation privately
* Unlock salaries instantly via wallet signature
* Manual and automated payroll execution
* Full payment history with on-chain proofs

### 👷 Worker

* Secure login with wallet + PIN
* View decrypted salary privately
* Verify role, schedule, and next payment
* Receive payments directly on Solana

---

# 📘 Step-by-Step User Guide

This guide walks through **exactly how to use ConfPay**, from first connection to automated payroll.

---

## 🛠️ Prerequisites

Before starting, ensure you have:

1. **Phantom Wallet** installed
2. Wallet switched to **Solana Devnet**
3. Devnet SOL for gas & salaries
   👉 [https://faucet.solana.com](https://faucet.solana.com)

---

## 🏢 Employer Guide

### 1️⃣ Connect Wallet & Initialize Company

1. Visit the ConfPay app
2. Click **“Connect Wallet”**
3. If this is your first time:

   * Enter your **Company Name**
   * Click **“Initialize Payroll”**
   * Approve the transaction in Phantom

This creates your **on-chain Organization Account**.

---

### 2️⃣ Employer Dashboard Overview

After setup, you’ll see:

* **Add Employee Form** (left)
* **Payroll Overview Card**
* **Employee Roster**
* **Payment History**
* **Unlock Salaries** button (top)

By default, all salaries appear as **Confidential**.

---

### 3️⃣ Add an Employee (Encrypted)

1. Enter:

   * Employee Name
   * Solana Wallet Address
   * Role / Job Title
   * Salary (e.g. `1.5 SOL`)
2. Set a **4-digit Access PIN**

   * Click **Gen** to auto-generate
   * **Share this PIN with the employee**
3. Choose payment schedule:

   * Weekly / Bi-Weekly / Monthly / Custom
4. Click **Add Employee**
5. Approve the transaction

📌 Salary is **encrypted locally before being sent on-chain**.

---

### 4️⃣ View & Unlock Salaries

1. Click **Unlock Salaries**
2. Phantom prompts you to **sign a message**
3. Salaries decrypt **instantly in your browser**

No network calls.
No delays.

---

### 5️⃣ Manual Payments

* Click **Pay Now** next to an employee
* ConfPay sends the correct amount
* Transaction is recorded on-chain
* Salary amount remains private

---

### 6️⃣ Automated Payroll (Clockwork Bot)

1. Click **Initialize Bot**
2. Fund the bot wallet with SOL
3. Toggle **ACTIVE**
4. Bot scans for due payments and executes them automatically

⚠️ Prototype note: browser tab must remain open.

---

## 👷 Worker Guide

### 1️⃣ Worker Login

1. Click **Worker Portal**
2. Connect the registered wallet
3. Enter:

   * Company Code (Employer wallet address)
   * Access PIN
   * 
4. Click **Login**

Access is granted only if **wallet + company + PIN** all match.

---

### 2️⃣ Worker Dashboard

Workers can view:

* Role & payment schedule
* Decrypted salary
* Next payment countdown
* Last payment received

Only the worker can see their salary.

---

## 🔐 Security Model

* Salaries are **never stored in plaintext**
* PINs are used only for local key derivation
* No private keys are stored
* Smart contracts **cannot decrypt salaries**
* RPC providers see only ciphertext

---

## 🌍 Why This Matters for Solana

Most privacy solutions hide **who paid whom**, whereas ConfPay hides **what was paid**.

This enables:

* Enterprise payroll
* DAO contributor compensation
* Private vesting schedules
* Confidential business logic
* Institutional adoption of Solana


---

 🏁 Hackathon Summary

> ConfPay proves that privacy is infrastructure, not a feature.
> By separating execution from visibility, we enable real businesses to move on-chain without exposing sensitive financial data.

---

## 📜 License

MIT
