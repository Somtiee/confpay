import { Connection, PublicKey, LAMPORTS_PER_SOL, Transaction, SystemProgram, ParsedTransactionWithMeta } from "@solana/web3.js";
import { PROGRAM_ID } from "./anchor";

export interface PaymentRecord {
  signature: string;
  timestamp: number;
  amount: number;
  sender: string;
  recipient: string;
  status: "success" | "pending" | "failed";
}

const HISTORY_CLEARED_KEY_PREFIX = "confpay_history_cleared_";

export function getHistoryStartTimestamp(walletAddress: string): number {
    if (typeof window === 'undefined') return 0;
    try {
        const stored = localStorage.getItem(HISTORY_CLEARED_KEY_PREFIX + walletAddress);
        return stored ? parseInt(stored, 10) : 0;
    } catch { return 0; }
}

export function clearPaymentHistory(walletAddress: string) {
    if (typeof window === 'undefined') return;
    localStorage.setItem(HISTORY_CLEARED_KEY_PREFIX + walletAddress, Date.now().toString());
}

/**
 * Sends SOL from employer to employee
 */
export async function payEmployee(
  connection: Connection,
  walletOrKeypair: any, // WalletAdapter OR Keypair
  recipientAddress: string,
  amountSol: number
): Promise<string> {
  const recipient = new PublicKey(recipientAddress);

  // Case 1: Automation Bot (Keypair)
  if (walletOrKeypair.secretKey) {
    const keypair = walletOrKeypair;
    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: keypair.publicKey,
        toPubkey: recipient,
        lamports: amountSol * LAMPORTS_PER_SOL,
      })
    );
    const signature = await connection.sendTransaction(transaction, [keypair]);
    await connection.confirmTransaction(signature, "confirmed");
    return signature;
  } 
  
  // Case 2: User Wallet (Adapter)
  else {
    if (!walletOrKeypair.publicKey) throw new Error("Wallet not connected");
    
    // Explicitly set integer lamports to avoid floating point errors
    const lamports = Math.floor(amountSol * LAMPORTS_PER_SOL);
    
    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: walletOrKeypair.publicKey,
        toPubkey: recipient,
        lamports: lamports,
      })
    );
  
    // Fetch fresh blockhash for reliability
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = walletOrKeypair.publicKey;

    let signature: string;

    try {
        // STRATEGY A: Sign First, Then Send (More Robust for Custom RPCs)
        // This ensures we use OUR connection (Helius) for the actual send, 
        // bypassing potential wallet extension RPC issues.
        if (typeof walletOrKeypair.signTransaction === 'function') {
            const signedTx = await walletOrKeypair.signTransaction(transaction);
            const rawTransaction = signedTx.serialize();
            signature = await connection.sendRawTransaction(rawTransaction, {
                skipPreflight: false,
                preflightCommitment: "confirmed",
            });
        } 
        // STRATEGY B: Standard sendTransaction (Fallback)
        else {
            signature = await walletOrKeypair.sendTransaction(transaction, connection);
        }
        
        // Confirm using latest strategy
        await connection.confirmTransaction({
            signature,
            blockhash,
            lastValidBlockHeight
        }, "confirmed");
        
        return signature;

    } catch (error: any) {
        console.error("Payment Error Details:", error);
        if (error.logs) {
            console.error("Transaction Logs:", error.logs);
        }
        throw error;
    }
  }
}

/**
 * Fetches payment history from on-chain data
 * We look for SOL transfers where:
 * - Employer is Sender (or Payroll PDA is Sender)
 * - Worker is Recipient
 */
export async function fetchPaymentHistory(
  connection: Connection,
  walletAddress: string,
  isEmployer: boolean,
  filterList: string[] = [], // For Worker: List of Employer Addresses to filter by
  additionalSenders: string[] = [], // For Employer: List of Bot/Other addresses to check as sender
  additionalAccountsToScan: string[] = [] // New: Accounts to explicitly scan signatures for (e.g. Employees)
): Promise<PaymentRecord[]> {
  console.log(`[PaymentHistory] Fetching for ${walletAddress} (${isEmployer ? "Employer" : "Worker"})`);
  
  const clearedTs = getHistoryStartTimestamp(walletAddress);

  // 1. Determine addresses to fetch signatures for
  const addressesToWatch = [new PublicKey(walletAddress)];

  // Deduplicate helper
  const addAddress = (addr: string) => {
      try {
          const pk = new PublicKey(addr);
          if (!addressesToWatch.some(a => a.equals(pk))) {
              addressesToWatch.push(pk);
          }
      } catch (e) {}
  };

  let payrollPDA: PublicKey | null = null;
  if (isEmployer) {
      // Add Payroll PDA
      try {
          const [pda] = PublicKey.findProgramAddressSync(
            [Buffer.from("payroll"), new PublicKey(walletAddress).toBuffer()],
            PROGRAM_ID
          );
          payrollPDA = pda;
          console.log(`[PaymentHistory] Including Payroll PDA: ${payrollPDA.toBase58()}`);
          addAddress(payrollPDA.toBase58());
      } catch (e) {
          console.error("Failed to derive Payroll PDA", e);
      }

      // Add Additional Senders (Bot)
      additionalSenders.forEach(addr => {
          console.log(`[PaymentHistory] Including Additional Sender: ${addr}`);
          addAddress(addr);
      });

      // Add Additional Accounts (Employees) - Crucial for finding lost bot payments
      additionalAccountsToScan.forEach(addr => {
          // console.log(`[PaymentHistory] Including Employee Scan: ${addr}`);
          addAddress(addr);
      });
  }

  // 2. Fetch Signatures for ALL addresses
  // We use a Map to deduplicate by signature string
  const signatureMap = new Map<string, any>();

  for (const address of addressesToWatch) {
      let retries = 3;
      let delay = 1000;
      while (retries > 0) {
          try {
              // EXTREMELY CONSERVATIVE LIMIT
              // Public RPC nodes are very strict. 
              // We fetch more signatures to ensure we capture relevant history
              const sigs = await connection.getSignaturesForAddress(
                address,
                { limit: 200 } 
              );
              console.log(`[PaymentHistory] Found ${sigs.length} signatures for ${address.toBase58()}`);
              sigs.forEach(s => signatureMap.set(s.signature, s));
              
              // Polite delay between signature fetches
              await new Promise(resolve => setTimeout(resolve, 500));
              break; // Success, break retry loop
          } catch (e: any) {
              const msg = e.message || JSON.stringify(e);
              if (msg.includes("403") || msg.includes("429") || msg.includes("Access forbidden") || msg.includes("fetch failed") || msg.includes("CORS")) {
                   console.warn(`[fetchSignatures] Network Limit (${msg}). Retrying in ${delay}ms... (${retries} left)`);
                   retries--;
                   if (retries === 0) console.error(`Failed to fetch signatures for ${address.toBase58()} after retries.`);
                   await new Promise(r => setTimeout(r, delay));
                   delay *= 1.5;
              } else {
                  console.error(`Failed to fetch signatures for ${address.toBase58()}`, e);
                  break; // Non-network error, don't retry
              }
          }
      }
  }

  const allSignatures = Array.from(signatureMap.values());
  // Sort by time descending (newest first)
  allSignatures.sort((a, b) => (b.blockTime || 0) - (a.blockTime || 0));

  // Limit total transactions to process to avoid long loading times and 429s
  const topSignatures = allSignatures.slice(0, 200);

  console.log(`[PaymentHistory] Total unique signatures to parse: ${topSignatures.length}`);

  const history: PaymentRecord[] = [];
  const signatureList = topSignatures.map(s => s.signature);
  
  if (signatureList.length === 0) return [];

  // 3. Fetch Transaction Details in Batches
  // We process in chunks to improve speed while respecting rate limits
  const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  const CHUNK_SIZE = 20; // Safe batch size for public RPCs

  for (let i = 0; i < signatureList.length; i += CHUNK_SIZE) {
      const batch = signatureList.slice(i, i + CHUNK_SIZE);
      console.log(`[PaymentHistory] Processing batch ${Math.floor(i/CHUNK_SIZE) + 1}/${Math.ceil(signatureList.length/CHUNK_SIZE)} (${batch.length} txs)`);

      let txs: (ParsedTransactionWithMeta | null)[] = [];
      let retries = 3;
      
      while (retries > 0) {
          try {
              txs = await connection.getParsedTransactions(batch, {
                  maxSupportedTransactionVersion: 0,
                  commitment: "confirmed"
              });
              break;
          } catch (e: any) {
              console.warn(`[PaymentHistory] Batch fetch failed (Retries: ${retries - 1})`, e);
              retries--;
              if (retries > 0) await wait(1000 * (4 - retries)); // Backoff
          }
      }

      // Process the batch
      for (let j = 0; j < batch.length; j++) {
          const sig = batch[j];
          const tx = txs[j]; // Corresponding result (or null/undefined if fetch failed)

          if (!tx || !tx.meta || tx.meta.err) {
              continue;
          }

          try {
              const timestamp = (tx.blockTime || 0) * 1000;
              
              // Filter out cleared history
              if (timestamp <= clearedTs) continue;

              // Check inner instructions for transfers
              let allInstructions: any[] = [...tx.transaction.message.instructions];
              if (tx.meta.innerInstructions) {
                  tx.meta.innerInstructions.forEach(inner => {
                      allInstructions = [...allInstructions, ...inner.instructions];
                  });
              }

              for (const ix of allInstructions) {
                  let isTransfer = false;
                  let transferInfo: any = null;

                  if ("program" in ix && ix.program === "system" && ix.parsed.type === "transfer") {
                      isTransfer = true;
                      transferInfo = ix.parsed.info;
                  } 
                  
                  if (isTransfer && transferInfo) {
                      const { destination, lamports, source } = transferInfo;

                      // Check if Sender is:
                      // 1. Current Wallet (if Employer)
                      // 2. Payroll PDA (if Employer)
                      // 3. Additional Sender (e.g. Bot)
                      const isSender = 
                          source === walletAddress || 
                          (payrollPDA && source === payrollPDA.toBase58()) ||
                          additionalSenders.includes(source);

                      // Check if Recipient is one of our known employees
                      const isRecipientEmployee = additionalAccountsToScan.includes(destination);

                      const isRecipient = destination === walletAddress;
                      let isValid = false;

                      if (isEmployer) {
                          // Employer View: Show ONLY transfers to employees (from Employer or Bot)
                          // This filters out "manual" transfers to non-employees or funding transfers (Employer -> Bot)
                          if (isRecipientEmployee && (isSender || additionalSenders.includes(source))) {
                              isValid = true;
                          }
                      } else {
                          // Worker View: Show incoming transfers
                          if (isRecipient) isValid = true;
                      }

                      if (isValid) {
                          history.push({
                              signature: sig,
                              timestamp,
                              amount: lamports / LAMPORTS_PER_SOL,
                              sender: source,
                              recipient: destination,
                              status: "success",
                          });
                          // Break inner loop (instructions) after finding valid transfer
                          break;
                      }
                  }
              }
          } catch (parseError) {
              console.error(`[PaymentHistory] Error parsing tx ${sig}`, parseError);
          }
      }

      // Polite delay between batches
      await wait(500);
  }

  console.log(`[PaymentHistory] Returning ${history.length} records`);
  return history;
}
