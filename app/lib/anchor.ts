"use client";

import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";

export const PROGRAM_ID = new PublicKey("EpWKv3uvNXVioG5J7WhyDoPy1G6LJ9vTbTcbiKZo6Jjw");

// Fallback RPC list
export const RPC_ENDPOINTS = [
    "https://devnet.helius-rpc.com/?api-key=b0cc0944-d97f-42ea-8336-fb7e52dad8e1",
    "https://api.devnet.solana.com",
];

export function getProvider(wallet: any, connection?: Connection) {
  if (!connection) {
      connection = new Connection(
        RPC_ENDPOINTS[0], // Default to primary
        {
            commitment: "confirmed",
            confirmTransactionInitialTimeout: 60000,
        }
      );
  }

  return new anchor.AnchorProvider(connection, wallet, {
    preflightCommitment: "confirmed",
  });
}
