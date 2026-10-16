import { BrowserProvider, type JsonRpcSigner } from 'ethers';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { networkConfig } from './contractClient';

export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  on(event: 'accountsChanged' | 'chainChanged', listener: (...args: unknown[]) => void): void;
  removeListener(event: 'accountsChanged' | 'chainChanged', listener: (...args: unknown[]) => void): void;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

type WalletContextValue = {
  address: string | null;
  chainId: number | null;
  connected: boolean;
  correctNetwork: boolean;
  error: string;
  connect: () => Promise<void>;
  switchNetwork: () => Promise<void>;
  disconnect: () => void;
  ensureNetwork: () => Promise<void>;
  getSigner: () => Promise<JsonRpcSigner>;
};

function walletErrorMessage(error: unknown, fallback: string) {
  const code = (error as { code?: number } | null)?.code;
  if (code === 4001) return 'The MetaMask request was rejected. No transaction was submitted.';
  if (code === 4100) return 'MetaMask has not authorized this account. Connect the account in MetaMask and retry.';
  if (code === 4900) return 'MetaMask is disconnected from all networks. Reconnect MetaMask and Ganache.';
  if (code === 4901) return `MetaMask is not connected to chain ${networkConfig.chainId}. Switch to ${networkConfig.chainName}.`;
  if (code === -32002) return 'A MetaMask request is already pending. Complete or reject it in the MetaMask popup first.';
  if (error instanceof Error && /network|fetch|connection|timeout|rpc/i.test(error.message)) {
    return `Could not reach ${networkConfig.rpcUrl}. Confirm Ganache is running on chain ${networkConfig.chainId}.`;
  }
  return error instanceof Error ? error.message : fallback;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function useWalletState(): WalletContextValue | null {
  const value = useContext(WalletContext);
  if (!value) return null;
  return value;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [error, setError] = useState('');

  const readChain = useCallback(async () => {
    if (!window.ethereum) return;
    const raw = await window.ethereum.request({ method: 'eth_chainId' });
    setChainId(Number.parseInt(String(raw), 16));
  }, []);

  useEffect(() => {
    const ethereum = window.ethereum;
    if (!ethereum) return;
    const handleAccountsChanged = (value?: unknown) => {
      const accounts = Array.isArray(value) ? value as string[] : [];
      setAddress(accounts?.[0] ?? null);
      setError('');
    };
    const handleChainChanged = (value?: unknown) => {
      const parsedChain = Number.parseInt(String(value ?? ''), 16);
      setChainId(Number.isFinite(parsedChain) ? parsedChain : null);
      setError('');
    };
    void ethereum.request({ method: 'eth_accounts' }).then((accounts) => setAddress((accounts as string[])[0] ?? null)).catch(() => undefined);
    void readChain().catch(() => undefined);
    ethereum.on('accountsChanged', handleAccountsChanged);
    ethereum.on('chainChanged', handleChainChanged);
    return () => {
      ethereum.removeListener('accountsChanged', handleAccountsChanged);
      ethereum.removeListener('chainChanged', handleChainChanged);
    };
  }, [readChain]);

  const ensureNetwork = useCallback(async () => {
    const ethereum = window.ethereum;
    if (!ethereum) throw new Error('MetaMask was not detected. Install or enable the MetaMask browser extension.');
    const expectedHex = `0x${networkConfig.chainId.toString(16)}`;
    const current = await ethereum.request({ method: 'eth_chainId' });
    if (String(current).toLowerCase() === expectedHex.toLowerCase()) {
      setChainId(networkConfig.chainId);
      return;
    }
    try {
      await ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: expectedHex }] });
    } catch (switchError) {
      const code = (switchError as { code?: number }).code;
      if (code !== 4902) throw switchError;
      await ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: expectedHex,
          chainName: networkConfig.chainName,
          rpcUrls: [networkConfig.rpcUrl],
          nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
        }],
      });
    }
    await readChain();
    const selected = await ethereum.request({ method: 'eth_chainId' });
    if (String(selected).toLowerCase() !== expectedHex.toLowerCase()) {
      throw new Error(`Switch MetaMask to ${networkConfig.chainName} (chain ID ${networkConfig.chainId}) to continue.`);
    }
  }, [readChain]);

  const connect = useCallback(async () => {
    try {
      setError('');
      const ethereum = window.ethereum;
      if (!ethereum) throw new Error('MetaMask was not detected. Install or enable the MetaMask browser extension.');
      const accounts = await ethereum.request({ method: 'eth_requestAccounts' }) as string[];
      if (!accounts.length) throw new Error('MetaMask did not return an account.');
      setAddress(accounts[0]);
      await ensureNetwork();
    } catch (reason) {
      const message = walletErrorMessage(reason, 'Could not connect to MetaMask.');
      setError(message);
      throw reason;
    }
  }, [ensureNetwork]);

  const switchNetwork = useCallback(async () => {
    try {
      setError('');
      await ensureNetwork();
    } catch (reason) {
      const message = walletErrorMessage(reason, 'Could not switch MetaMask to the local network.');
      setError(message);
      throw new Error(message);
    }
  }, [ensureNetwork]);

  const getSigner = useCallback(async () => {
    if (!window.ethereum) throw new Error('MetaMask was not detected.');
    try {
      await ensureNetwork();
      const provider = new BrowserProvider(window.ethereum as never, 'any');
      return await provider.getSigner();
    } catch (reason) {
      const message = walletErrorMessage(reason, 'Could not access a MetaMask signer.');
      setError(message);
      throw new Error(message);
    }
  }, [ensureNetwork]);

  const disconnect = useCallback(() => {
    // EIP-1193 does not provide a standard disconnect method; this only clears app state.
    setAddress(null);
    setError('');
  }, []);

  const value = useMemo<WalletContextValue>(() => ({
    address,
    chainId,
    connected: Boolean(address),
    correctNetwork: chainId === networkConfig.chainId,
    error,
    connect,
    switchNetwork,
    disconnect,
    ensureNetwork,
    getSigner,
  }), [address, chainId, error, connect, switchNetwork, disconnect, ensureNetwork, getSigner]);

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const value = useWalletState();
  if (!value) throw new Error('useWallet must be used inside WalletProvider.');
  return value;
}
