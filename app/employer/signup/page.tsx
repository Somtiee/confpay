"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import dynamic from "next/dynamic";
import { initializePayroll, checkCompanyRegistration } from "../../lib/solana";
import { useRpc } from "../../providers";

const WalletMultiButton = dynamic(
  async () => (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false }
);

export default function EmployerSignup() {
  const router = useRouter();
  const { connection } = useConnection();
  const { switchEndpoint } = useRpc();
  const { publicKey, wallet } = useWallet();
  const [isMounted, setIsMounted] = useState(false);
  const [isCheckingCompany, setIsCheckingCompany] = useState(true);
  const [isInitializing, setIsInitializing] = useState(false);
  const [isRegistered, setIsRegistered] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [isAirdropping, setIsAirdropping] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  // 1. Check On-Chain Registration Status
  const [registrationError, setRegistrationError] = useState<string | null>(null);

  useEffect(() => {
    if (!publicKey || !connection) {
       setIsCheckingCompany(false);
       return;
    }

    const checkRegistration = async () => {
      setIsCheckingCompany(true);
      setRegistrationError(null);
      try {
        const exists = await checkCompanyRegistration(connection, publicKey);
        setIsRegistered(exists);
      } catch (e: any) {
        console.error("Registration check failed", e);
        const msg = e.message || JSON.stringify(e);
        
        // Show retry/network error message
        setRegistrationError("Network busy. Struggling to verify account...");
        
        if (msg.includes("403") || msg.includes("429") || msg.includes("Access forbidden") || msg.includes("fetch failed") || msg.includes("CORS")) {
            switchEndpoint();
        }
      } finally {
        setIsCheckingCompany(false);
      }
    };
    
    checkRegistration();
  }, [publicKey, connection]);

  // 2. Redirect Logic
  useEffect(() => {
     if (isCheckingCompany || !publicKey || registrationError) return;
     
     if (isRegistered) {
         console.log("Company already initialized on-chain. Redirecting...");
         router.push("/employer");
     }
  }, [isCheckingCompany, isRegistered, publicKey, router]);

  const requestAirdrop = async () => {
    if (!publicKey || !connection) return;
    setIsAirdropping(true);
    try {
        const sig = await connection.requestAirdrop(publicKey, 2 * LAMPORTS_PER_SOL);
        const latestBlockHash = await connection.getLatestBlockhash();
        await connection.confirmTransaction({
          blockhash: latestBlockHash.blockhash,
          lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
          signature: sig,
        });
        alert("Airdrop successful! You received 2 SOL.");
    } catch (e) {
        console.error("Airdrop failed", e);
        alert("Airdrop failed: " + (e as Error).message);
    } finally {
        setIsAirdropping(false);
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!publicKey || !wallet) return;

    if (!companyName.trim()) {
      alert("Please enter a Company Name");
      return;
    }

    setIsInitializing(true);

    try {
        // 1. Initialize On-Chain
        const sig = await initializePayroll(wallet.adapter, companyName);
        console.log("Payroll Initialized:", sig);

        // 2. Redirect
        router.push("/employer");

    } catch (err) {
        console.error("Initialization failed:", err);
        
        let msg = (err as Error).message;
        // Dev-only helpful message
        if (msg.includes("Program not found") || msg.includes("Account not found")) {
             msg = "⚠️ DEV ERROR: Smart Contract not deployed on this network.\n\n" + 
                   "Please run `anchor deploy` and update PROGRAM_ID in lib/solana.ts.";
        }

        if (msg.includes("custom program error: 0x0") || msg.includes("already in use")) {
            alert("✅ Company seems to be already registered! Redirecting to dashboard...");
            router.push("/employer");
            return;
        }
        
        alert("❌ Failed to register company: " + msg);
    } finally {
        setIsInitializing(false);
    }
  };

  if (!isMounted) return null;

  if (isCheckingCompany) {
      return (
          <div className="min-h-screen flex items-center justify-center">
              <div className="animate-pulse text-gray-500">Checking registration status...</div>
          </div>
      );
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-4 bg-gray-50">
      <div className="max-w-md w-full bg-white rounded-xl shadow-lg p-8 animate-fade-in">
        <h1 className="text-3xl font-bold mb-6 text-center text-gray-900">Employer Signup</h1>
        
        <div className="flex flex-col items-center justify-center mb-8 gap-4">
          <WalletMultiButton />
          {publicKey && (
            <button
                onClick={requestAirdrop}
                disabled={isAirdropping}
                className="text-sm text-blue-600 hover:text-blue-800 underline disabled:opacity-50"
            >
                {isAirdropping ? "Requesting Airdrop..." : "Get Devnet SOL (Faucet)"}
            </button>
          )}
        </div>

        {/* Status / Error Banner */}
        {(isCheckingCompany || registrationError) && (
          <div className={`mb-6 p-3 rounded-lg text-sm flex flex-col gap-2 ${
            registrationError ? "bg-yellow-50 text-yellow-700" : "bg-blue-50 text-blue-700"
          }`}>
            <span>
              {registrationError || "Verifying account status on blockchain..."}
            </span>
            {registrationError && (
               <button
                  onClick={() => router.push("/employer")}
                  className="text-xs text-yellow-800 underline font-semibold hover:text-yellow-900 text-left"
               >
                  I've already registered (Force Access)
               </button>
            )}
          </div>
        )}

        {publicKey ? (
          <form onSubmit={handleSignup} className="space-y-6">
            <div>
              <label htmlFor="companyName" className="block text-sm font-medium text-gray-700 mb-1">Company Name</label>
              <input
                id="companyName"
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="Enter your company name"
                className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                required
              />
            </div>

            <div className="bg-blue-50 border border-blue-100 rounded-lg p-4 text-sm text-blue-800">
               <p>
                 <strong>Note:</strong> Your company identity will be tied directly to your wallet address.
               </p>
               <p className="mt-2">
                 Click below to initialize your Payroll account on the Inco Confidential Blockchain.
               </p>
            </div>

            <button
              type="submit"
              disabled={isInitializing}
              className={`w-full py-3 px-4 bg-gradient-to-r from-blue-600 to-cyan-600 text-white font-bold rounded-lg shadow-lg hover:shadow-blue-500/30 transition-all transform hover:-translate-y-0.5 ${isInitializing ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {isInitializing ? "Initializing..." : "Initialize Payroll"}
            </button>
          </form>
        ) : (
          <p className="text-center text-gray-500">
            Please connect your wallet to continue.
          </p>
        )}
      </div>
    </main>
  );
}
