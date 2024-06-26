import { BigNumber, providers, utils } from "ethers";
import { UserOperationStruct } from "@account-abstraction/contracts";
import { isTwUrl } from "../../../utils/url";
import { hexlifyUserOp } from "./utils";
import { setAnalyticsHeaders } from "../../../utils/headers";
import {
  EstimateUserOpGasRawResult,
  EstimateUserOpGasResult,
  ZkTransactionInput,
} from "../types";
import { MANAGED_ACCOUNT_GAS_BUFFER } from "./constants";

export const DEBUG = false; // TODO set as public flag

export class HttpRpcClient {
  private readonly userOpJsonRpcProvider: providers.JsonRpcProvider;

  initializing: Promise<void>;
  bundlerUrl: string;
  entryPointAddress: string;
  chainId: number;

  constructor(
    bundlerUrl: string,
    entryPointAddress: string,
    chainId: number,
    clientId?: string,
    secretKey?: string,
  ) {
    this.bundlerUrl = bundlerUrl;
    this.entryPointAddress = entryPointAddress;
    this.chainId = chainId;

    const headers: Record<string, string> = {};

    if (isTwUrl(this.bundlerUrl)) {
      const bundleId =
        typeof globalThis !== "undefined" && "APP_BUNDLE_ID" in globalThis
          ? ((globalThis as any).APP_BUNDLE_ID as string)
          : undefined;

      if (secretKey) {
        headers["x-secret-key"] = secretKey;
      } else if (clientId) {
        headers["x-client-id"] = clientId;

        if (bundleId) {
          headers["x-bundle-id"] = bundleId;
        }
      }

      // Dashboard token
      if (
        typeof globalThis !== "undefined" &&
        "TW_AUTH_TOKEN" in globalThis &&
        typeof (globalThis as any).TW_AUTH_TOKEN === "string"
      ) {
        headers["authorization"] = `Bearer ${
          (globalThis as any).TW_AUTH_TOKEN as string
        }`;
      }

      // CLI token
      if (
        typeof globalThis !== "undefined" &&
        "TW_CLI_AUTH_TOKEN" in globalThis &&
        typeof (globalThis as any).TW_CLI_AUTH_TOKEN === "string"
      ) {
        headers["authorization"] = `Bearer ${
          (globalThis as any).TW_CLI_AUTH_TOKEN as string
        }`;
        headers["x-authorize-wallet"] = "true";
      }

      setAnalyticsHeaders(headers);
    }

    this.userOpJsonRpcProvider = new providers.StaticJsonRpcProvider(
      {
        url: this.bundlerUrl,
        headers,
      },
      {
        name: "Connected bundler network",
        chainId,
      },
    );
    this.initializing = this.validateChainId();
  }

  async validateChainId(): Promise<void> {
    if (this.chainId === 300 || this.chainId === 324) {
      return;
    }
    // validate chainId is in sync with expected chainid
    const chain = await this.userOpJsonRpcProvider.send("eth_chainId", []);
    const bundlerChain = parseInt(chain);
    if (bundlerChain !== this.chainId) {
      throw new Error(
        `bundler ${this.bundlerUrl} is on chainId ${bundlerChain}, but provider is on chainId ${this.chainId}`,
      );
    }
  }

  /**
   * send a UserOperation to the bundler
   * @param userOp1 - The UserOperation to send
   * @returns userOpHash the id of this operation, for getUserOperationTransaction
   */
  async sendUserOpToBundler(userOp1: UserOperationStruct): Promise<string> {
    await this.initializing;
    const hexifiedUserOp = await hexlifyUserOp(userOp1);
    const jsonRequestData: [UserOperationStruct, string] = [
      hexifiedUserOp,
      this.entryPointAddress,
    ];
    await this.printUserOperation("eth_sendUserOperation", jsonRequestData);
    return await this.userOpJsonRpcProvider.send("eth_sendUserOperation", [
      hexifiedUserOp,
      this.entryPointAddress,
    ]);
  }

  async estimateUserOpGas(
    userOp: Partial<UserOperationStruct>,
  ): Promise<EstimateUserOpGasResult> {
    await this.initializing;
    const hexifiedUserOp = await hexlifyUserOp(userOp);
    const jsonRequestData: [UserOperationStruct, string] = [
      hexifiedUserOp,
      this.entryPointAddress,
    ];
    await this.printUserOperation(
      "eth_estimateUserOperationGas",
      jsonRequestData,
    );
    const data: EstimateUserOpGasRawResult =
      await this.userOpJsonRpcProvider.send("eth_estimateUserOperationGas", [
        hexifiedUserOp,
        this.entryPointAddress,
      ]);
    // adds gas buffer to callGasLimit to account for ManagedAccountFactory delegate calls
    return {
      preVerificationGas: BigNumber.from(data.preVerificationGas),
      verificationGas: BigNumber.from(data.verificationGas),
      verificationGasLimit: BigNumber.from(data.verificationGasLimit),
      callGasLimit: BigNumber.from(data.callGasLimit).add(
        MANAGED_ACCOUNT_GAS_BUFFER,
      ),
    };
  }

  async getUserOperationGasPrice(): Promise<{
    maxFeePerGas: string;
    maxPriorityFeePerGas: string;
  }> {
    await this.initializing;
    return await this.userOpJsonRpcProvider.send(
      "thirdweb_getUserOperationGasPrice",
      [],
    );
  }

  async getUserOperationReceipt(userOpHash: string): Promise<any> {
    await this.initializing;
    return await this.userOpJsonRpcProvider.send(
      "eth_getUserOperationReceipt",
      [userOpHash],
    );
  }

  async zkPaymasterData(
    transactionInput: providers.TransactionRequest,
  ): Promise<any> {
    await this.initializing;
    return await this.userOpJsonRpcProvider.send("zk_paymasterData", [
      await hexlifyUserOp({
        ...transactionInput,
        gas: transactionInput.gasLimit,
      }),
    ]);
  }

  async zkBroadcastTransaction(
    transactionInput: ZkTransactionInput,
  ): Promise<any> {
    await this.initializing;
    return await this.userOpJsonRpcProvider.send("zk_broadcastTransaction", [
      transactionInput,
    ]);
  }

  private async printUserOperation(
    method: string,
    [userOp1, entryPointAddress]: [UserOperationStruct, string],
  ): Promise<void> {
    if (!DEBUG) {
      return;
    }
    const userOp = await utils.resolveProperties(userOp1);
    console.debug(
      "sending",
      method,
      {
        ...userOp,
        // initCode: (userOp.initCode ?? '').length,
        // callData: (userOp.callData ?? '').length
      },
      entryPointAddress,
    );
  }
}
