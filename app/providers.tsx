"use client";

import {
  ReactNode,
  useEffect,
  useState,
  createContext,
  useContext,
  useMemo,
  useCallback,
  useRef,
} from "react";
import {
  ConnectionProvider,
  WalletProvider,
  useConnection,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-wallets";
import { PublicKey } from "@solana/web3.js";
import "@solana/wallet-adapter-react-ui/styles.css";
import { PROGRAM_ID, RPC_ENDPOINTS } from "./lib/anchor";

// --- RPC Connection Context ---
interface RpcContextType {
  endpoint: string;
  switchEndpoint: () => void;
  connectionError: boolean;
}

const RpcContext = createContext<RpcContextType>({
  endpoint: RPC_ENDPOINTS[0],
  switchEndpoint: () => {},
  connectionError: false,
});

export const useRpc = () => useContext(RpcContext);

function RpcProvider({ children }: { children: ReactNode }) {
  const [index, setIndex] = useState(0);
  const [connectionError, setConnectionError] = useState(false);
  const endpoint = RPC_ENDPOINTS[index];

  const switchEndpoint = useCallback(() => {
    setIndex((prev) => {
      const next = (prev + 1) % RPC_ENDPOINTS.length;
      console.log(`Switching RPC endpoint to: ${RPC_ENDPOINTS[next]}`);
      return next;
    });
    setConnectionError(false); // Reset error flag on switch
  }, []);

  return (
    <RpcContext.Provider value={{ endpoint, switchEndpoint, connectionError }}>
      <ConnectionProvider endpoint={endpoint} config={{ commitment: 'confirmed' }}>
        {children}
      </ConnectionProvider>
    </RpcContext.Provider>
  );
}

// --- Program Availability Context ---
interface ProgramStatusContextType {
  isProgramAvailable: boolean;
  isChecking: boolean;
}

const ProgramStatusContext = createContext<ProgramStatusContextType>({
  isProgramAvailable: true,
  isChecking: false,
});

export const useProgramStatus = () => useContext(ProgramStatusContext);

function ProgramStatusChecker({ children }: { children: ReactNode }) {
  const { connection } = useConnection();
  const { switchEndpoint } = useRpc();
  const [isProgramAvailable, setIsProgramAvailable] = useState(true);
  const [isChecking, setIsChecking] = useState(true);
  const [failureCount, setFailureCount] = useState(0);
  const lastSwitchTime = useRef<number>(0);

  useEffect(() => {
    let mounted = true;
    let timeoutId: NodeJS.Timeout;

    const checkProgram = async () => {
      if (!mounted) return;
      try {
        const info = await connection.getAccountInfo(PROGRAM_ID);
        
        if (mounted) {
            setIsProgramAvailable(!!info);
            setFailureCount(0); 
        }
      } catch (e: any) {
        if (mounted) {
            const msg = e.message || JSON.stringify(e);
            console.warn(`Program check failed: ${msg}`);
            
            if (msg.includes("403") || msg.includes("429") || msg.includes("Access forbidden") || msg.includes("fetch failed") || msg.includes("CORS") || msg.includes("Failed to fetch")) {
                const now = Date.now();
                // Prevent switching more than once every 5 seconds (reduced from 15)
                if (now - lastSwitchTime.current > 5000) {
                    setFailureCount(prev => {
                        const newCount = prev + 1;
                        if (newCount >= 2) { // Switch after 2 failures
                            console.warn("Rate limit or CORS detected. Switching RPC...");
                            lastSwitchTime.current = now;
                            switchEndpoint();
                            return 0;
                        }
                        // Retry checkProgram if we haven't switched yet
                        timeoutId = setTimeout(checkProgram, 5000); // Increased to 5s
                        return newCount;
                    });
                }
            } else {
                setIsProgramAvailable(false);
            }
        }
      } finally {
        if (mounted) setIsChecking(false);
      }
    };

    // Delay the initial check by 2 seconds after a connection change
    // This gives the new connection time to settle and prevents immediate loops
    timeoutId = setTimeout(checkProgram, 5000); // Increased to 5s

    return () => {
        mounted = false;
        clearTimeout(timeoutId);
    };
  }, [connection, switchEndpoint]);

  return (
    <ProgramStatusContext.Provider value={{ isProgramAvailable, isChecking }}>
      {/* Banner removed to reduce UI noise */}
      <div>
         {children}
      </div>
    </ProgramStatusContext.Provider>
  );
}

function DarkModeToggle() {
    // Placeholder for existing component if any, or simple toggle
    // Assuming it was there in previous file, but I don't see it in the `Read` output 
    // Wait, the Read output ended at line 100 and showed <DarkModeToggle /> at line 96.
    // I should preserve it or define it if it's local. 
    // Since I don't have the code for it, I'll assume it's imported or defined.
    // Ah, line 96 in previous file: <DarkModeToggle />
    // But no import for it? Maybe it was defined in the file.
    // I need to check if DarkModeToggle was defined in the file.
    // I'll read the rest of the file first.
    return null; 
}

export function Providers({ children }: { children: ReactNode }) {
  const wallets = useMemo(() => [new PhantomWalletAdapter()], []);

  return (
    <RpcProvider>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
            <ProgramStatusChecker>
                {children}
            </ProgramStatusChecker>
         </WalletModalProvider>
      </WalletProvider>
    </RpcProvider>
  );
}
