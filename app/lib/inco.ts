import { encryptValue } from "@inco/solana-sdk/encryption";
import { decrypt as attestDecrypt } from "@inco/solana-sdk/attested-decrypt";
import { PublicKey } from "@solana/web3.js";
import { getEncryptionKey, encryptAES, decryptAES, deriveKeyFromPin } from "./crypto";

// Inco Input Types (based on standard TEE/FHE patterns)
// 1: u8, 2: u16, 3: u32, 4: u64, 5: u128
const INPUT_TYPE_U64 = 4;

const LAMPORTS_PER_SOL = 1_000_000_000;

// Magic Header for Dual Encryption: [0xCA, 0xFE, 0xBA, 0xBE]
const MAGIC_HEADER = [202, 254, 186, 190];

function hexToBytes(hex: string): Uint8Array {
  if (hex.startsWith('0x')) hex = hex.slice(2);
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes as unknown as Uint8Array;
}

function bytesToHex(bytes: Uint8Array | number[]): string {
  const byteArray = Array.isArray(bytes) ? new Uint8Array(bytes) : bytes;
  return Array.from(byteArray)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function encryptSalary(
  salary: number,
  recipientAddress: string,
  pin?: string,
  wallet?: { signMessage?: (msg: Uint8Array) => Promise<Uint8Array> }
): Promise<{ ciphertext: number[]; input_type: number }> {
  try {
    // Convert SOL -> lamports (integer)
    const salaryLamports = Math.floor(salary * LAMPORTS_PER_SOL);
    const salaryBig = BigInt(salaryLamports);

    // 1. Inco Encryption (Primary for FHE)
    let encryptedBytes = new Uint8Array(0) as unknown as Uint8Array;
    try {
        const encryptedHex = await encryptValue(salaryBig);
        encryptedBytes = hexToBytes(encryptedHex) as unknown as Uint8Array;
    } catch (incoErr) {
        console.warn("Inco encryption failed, proceeding with AES only if available", incoErr);
    }

    // 2. AES Encryption (Secondary for Viewability/Recovery)
    // We try to encrypt with BOTH PIN (for Worker) and Wallet (for Employer) if available.
    // Format: MAGIC (4) + BLOCK_COUNT (1) + [LEN (1) + DATA]... + INCO_DATA
    
    const aesBlocks: Uint8Array[] = [];

    // Block 1: PIN (if available)
    if (pin) {
        try {
            const key = await deriveKeyFromPin(pin);
            const aesBytes = await encryptAES(salary.toString(), key);
            aesBlocks.push(aesBytes);
        } catch (e) {
            console.warn("AES PIN Encryption failed:", e);
        }
    }

    // Block 2: Wallet (if available)
    if (wallet && wallet.signMessage) {
        try {
            const key = await getEncryptionKey(wallet);
            const aesBytes = await encryptAES(salary.toString(), key);
            aesBlocks.push(aesBytes);
        } catch (e) {
            console.warn("AES Wallet Encryption failed:", e);
        }
    }

    if (aesBlocks.length > 0) {
        // Calculate total size
        let totalAesSize = 0;
        aesBlocks.forEach(b => totalAesSize += (1 + b.length)); // 1 byte len + data
        
        const totalLen = 4 + 1 + totalAesSize + encryptedBytes.length; // Magic + Count + Blocks + Inco
        
        // Check fit in 256 bytes
        if (totalLen <= 256) {
             const result = new Uint8Array(totalLen);
             result.set(MAGIC_HEADER, 0);
             result[4] = aesBlocks.length; // Block Count
             
             let offset = 5;
             for (const block of aesBlocks) {
                 result[offset] = block.length;
                 result.set(block, offset + 1);
                 offset += (1 + block.length);
             }
             
             if (encryptedBytes.length > 0) {
                 result.set(encryptedBytes, offset);
             }
             return {
                 ciphertext: Array.from(result),
                 input_type: INPUT_TYPE_U64
             };
        } else {
             console.warn("Ciphertext too large for Dual Storage. Prioritizing Viewable Salary (AES).");
             // Prioritize AES Only
             const aesLen = 4 + 1 + totalAesSize;
             if (aesLen <= 256) {
                 const result = new Uint8Array(aesLen);
                 result.set(MAGIC_HEADER, 0);
                 result[4] = aesBlocks.length;
                 
                 let offset = 5;
                 for (const block of aesBlocks) {
                     result[offset] = block.length;
                     result.set(block, offset + 1);
                     offset += (1 + block.length);
                 }
                 
                 return {
                     ciphertext: Array.from(result),
                     input_type: INPUT_TYPE_U64
                 };
             }
        }
    }
    
    // Fallback to pure Inco if AES failed or no wallet/pin
    if (encryptedBytes.length === 0) throw new Error("Both Inco and AES encryption failed");
    
    return {
      ciphertext: Array.from(encryptedBytes),
      input_type: INPUT_TYPE_U64
    };
  } catch (e) {
    console.error("Encryption failed:", e);
    throw new Error("Encryption failed: " + e);
  }
}

export async function decryptSalaries(
  encryptedSalaries: (Uint8Array | number[])[],
  wallet: { publicKey: PublicKey | null; signMessage?: (msg: Uint8Array) => Promise<Uint8Array> },
  pin?: string
): Promise<(number | null)[]> {
  // If no PIN provided, we might still need wallet for Inco fallback or legacy wallet-based AES
  if (!pin && (!wallet.publicKey || !wallet.signMessage)) {
    throw new Error("Wallet not connected or does not support message signing");
  }

  const results: (number | null)[] = new Array(encryptedSalaries.length).fill(null);
  const incoIndices: number[] = [];
  const incoHandles: string[] = [];
  let aesKey: CryptoKey | null = null;

    // 2. AES Decryption (Fast Path)
    try {
        let aesKeys: CryptoKey[] = [];
        
        // Collect available keys
        if (pin) {
            try {
                aesKeys.push(await deriveKeyFromPin(pin));
            } catch(e) { console.warn("Pin key derivation failed", e); }
        }
        if (wallet.signMessage) {
             try {
                aesKeys.push(await getEncryptionKey(wallet));
             } catch(e) { console.warn("Wallet key derivation failed", e); }
        }

        if (aesKeys.length > 0) {
            // Check each item
            await Promise.all(encryptedSalaries.map(async (raw, i) => {
                if (!raw) {
                    results[i] = null;
                    return;
                }
                const bytes = Array.isArray(raw) ? new Uint8Array(raw as number[]) : raw as Uint8Array;
                
                // Check Magic Header [0xCA, 0xFE, 0xBA, 0xBE]
                if (bytes.length > 5 && 
                    bytes[0] === MAGIC_HEADER[0] && 
                    bytes[1] === MAGIC_HEADER[1] && 
                    bytes[2] === MAGIC_HEADER[2] && 
                    bytes[3] === MAGIC_HEADER[3]) {
                    
                    try {
                        const blockCount = bytes[4];
                        let offset = 5;
                        
                        // Loop through blocks
                        // NOTE: If blockCount is huge (legacy data bug), this loop might be weird but 'offset' check saves us.
                        // Legacy data: Byte 4 was 'Len' (e.g. 30).
                        // If we interpret 30 as 'Count', we loop 30 times?
                        // But inside loop, we read 'Len' at offset.
                        // Legacy data: Byte 5 is IV[0].
                        // This will likely fail parsing or decryption.
                        // We assume legacy data is broken anyway (as per user report).
                        // But let's try to be robust.
                        
                        let decrypted = false;
                        for (let b = 0; b < blockCount; b++) {
                            if (offset >= bytes.length) break;
                            
                            const blockLen = bytes[offset];
                            const blockEnd = offset + 1 + blockLen;
                            
                            if (blockEnd <= bytes.length) {
                                const blockData = bytes.slice(offset + 1, blockEnd);
                                
                                // Try all keys on this block
                                for (const key of aesKeys) {
                                    try {
                                        const plainStr = await decryptAES(blockData, key);
                                        results[i] = parseFloat(plainStr);
                                        console.log(`AES Decryption Success [${i}]:`, plainStr);
                                        decrypted = true;
                                        break; 
                                    } catch (e) {
                                        // Key didn't work
                                    }
                                }
                            }
                            if (decrypted) break;
                            offset = blockEnd;
                        }
                        
                        if (decrypted) return; // Success

                    } catch (e) {
                         console.warn(`AES Decryption failed for index ${i}, falling back to Inco.`);
                    }
                }
                
                // If not Magic Header, or if we fell through
                incoIndices.push(i);
                incoHandles.push(bytesToHex(bytes));
            }));
        } else {
             // No key, push all to Inco
             encryptedSalaries.forEach((raw, i) => {
                 if (raw) {
                     incoIndices.push(i);
                     const bytes = Array.isArray(raw) ? new Uint8Array(raw as number[]) : raw as Uint8Array;
                     incoHandles.push(bytesToHex(bytes));
                 } else {
                     results[i] = null;
                 }
             });
        }
    } catch (e) {
        console.warn("AES Setup Failed, pushing all to Inco:", e);
        // Push all to Inco as backup
         encryptedSalaries.forEach((raw, i) => {
             if (raw) {
                 incoIndices.push(i);
                 const bytes = Array.isArray(raw) ? new Uint8Array(raw as number[]) : raw as Uint8Array;
                 incoHandles.push(bytesToHex(bytes));
             } else {
                 results[i] = null;
             }
         });
    }

    // 3. Inco Decryption (Fallback / Main Path for Cross-User)
    console.log(`Decryption: Starting Inco FHE decryption for ${incoIndices.length} items...`);
  if (incoIndices.length > 0 && wallet.publicKey && wallet.signMessage) {
    try {
        const cleanHandles = incoHandles.map(h => h.startsWith('0x') ? h : '0x' + h);
        const result = await attestDecrypt(cleanHandles, {
            address: wallet.publicKey,
            signMessage: wallet.signMessage
        });

        if (result.plaintexts) {
            result.plaintexts.forEach((val, idx) => {
                const originalIdx = incoIndices[idx];
                const lamports = Number(val);
                results[originalIdx] = isNaN(lamports) ? null : lamports / LAMPORTS_PER_SOL;
            });
        }
    } catch (e) {
        console.error("Batch Attested Decryption failed:", e);
        // Do not throw, return partial results (AES ones are good)
    }
  }

  return results;
}

export async function decryptSalary(
  encryptedSalary: Uint8Array | number[],
  wallet: { publicKey: PublicKey | null; signMessage?: (msg: Uint8Array) => Promise<Uint8Array> },
  pin?: string
): Promise<number | null> {
    const results = await decryptSalaries([encryptedSalary], wallet, pin);
    return results[0];
}
