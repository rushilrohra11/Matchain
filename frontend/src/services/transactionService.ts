import {
  Interface,
  type InterfaceAbi,
  type TransactionReceipt,
  type Provider,
  type TransactionResponse,
  Contract,
} from 'ethers';

export interface VerificationRequirement {
  contractAddress: string;
  abi: InterfaceAbi;
  eventName?: string;
  validateArgs?: (args: any) => boolean;
  checkState?: (contract: Contract) => Promise<boolean>;
}

export interface VerificationResult<T = any> {
  success: boolean;
  transactionHash: string;
  blockNumber: number;
  event?: {
    name: string;
    args: T;
  };
  error?: string;
  receipt: TransactionReceipt;
}

/**
 * Shared transaction handler for MatChain blockchain operations.
 * Ensures that transactions are not just mined, but also verified against
 * expected events and contract state.
 */
export async function verifyTransaction<T = any>(
  response: TransactionResponse,
  requirement: VerificationRequirement,
  provider: Provider
): Promise<VerificationResult<T>> {
  const receipt = await response.wait();

  if (!receipt) {
    throw new Error(`Transaction ${response.hash} was not found or failed to provide a receipt.`);
  }

  const result: VerificationResult<T> = {
    success: false,
    transactionHash: response.hash,
    blockNumber: receipt.blockNumber,
    receipt,
  };

  // 1. Check receipt status
  if (receipt.status !== 1) {
    result.error = `Transaction reverted on chain (status 0).`;
    return result;
  }

  // 2. Verify destination address (optional but recommended)
  if (receipt.to && receipt.to.toLowerCase() !== requirement.contractAddress.toLowerCase()) {
    result.error = `Transaction was sent to an unexpected address: ${receipt.to}`;
    return result;
  }

  // 3. Decode logs if an event is expected
  if (requirement.eventName) {
    const contractInterface = new Interface(requirement.abi);
    let foundEvent = false;

    for (const log of receipt.logs) {
      // Only parse logs from the target contract
      if (log.address.toLowerCase() !== requirement.contractAddress.toLowerCase()) continue;

      try {
        const parsed = contractInterface.parseLog(log);
        if (parsed?.name === requirement.eventName) {
          const args = Object.fromEntries(
            parsed.fragment.inputs.map((input, index) => [
              input.name,
              parsed.args[index]
            ])
          );

          // Optional: Validate arguments
          if (!requirement.validateArgs || requirement.validateArgs(args)) {
            result.event = { name: parsed.name, args: args as any };
            foundEvent = true;
            break;
          }
        }
      } catch (e) {
        // Skip logs that don't match the ABI
      }
    }

    if (!foundEvent) {
      result.error = `Transaction mined, but the expected event '${requirement.eventName}' was missing or had invalid arguments.`;
      return result;
    }
  }

  // 4. Verify post-transaction contract state
  if (requirement.checkState) {
    const contract = new Contract(requirement.contractAddress, requirement.abi, provider);
    const stateValid = await requirement.checkState(contract);
    if (!stateValid) {
      result.error = `Transaction mined and events found, but post-transaction contract state verification failed.`;
      return result;
    }
  }

  result.success = true;
  return result;
}
