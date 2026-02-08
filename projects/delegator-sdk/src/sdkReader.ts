import { AlgorandClient } from "@algorandfoundation/algokit-utils";
import { makeEmptyTransactionSigner } from "algosdk";
import { getConstructorConfig } from "./networkConfig";
import { DelegatorContractArgs, DelegatorGlobalState, ReaderConstructorArgs } from "./types";
import { errorTransformer, wrapErrors } from "./util/wrapErrors";
import { DelegatorClient } from "./generated/DelegatorClient";

export class XGovDelegatorReaderSDK {
  public algorand: AlgorandClient;
  public appId: bigint;
  public readClient: DelegatorClient;
  public concurrency: number;
  public debug?: boolean;

  constructor({ algorand, concurrency = 4, debug, ...rest }: ReaderConstructorArgs) {
    const { appId, readerAccount } = getConstructorConfig(rest);
    this.algorand = algorand;
    algorand.setSuggestedParamsCacheTimeout(6000); // 6s or ~2 rounds of cache. reduces GET requests to /params
    algorand.registerErrorTransformer(errorTransformer);
    this.appId = appId;
    this.concurrency = concurrency;
    this.debug = debug;
    this.readClient = new DelegatorClient({
      algorand: this.algorand,
      appId: this.appId,
      defaultSender: readerAccount,
      defaultSigner: makeEmptyTransactionSigner(),
    });
  }

  async getGlobalState(): Promise<DelegatorGlobalState> {
    const state = await this.readClient.state.global.getAll();
    if (!state) {
      throw new Error(`Failed to fetch global state for appId ${this.appId}`);
    }
    return state as DelegatorGlobalState
  }

  @wrapErrors()
  async getAccountAlgoHours({ periodStart, account }: DelegatorContractArgs["getAccountAlgoHours(uint64,address)uint64"]): Promise<bigint> {
    const { return: retVal } = await this.readClient.send.getAccountAlgoHours({ args: { account, periodStart } })
    return retVal!
  }

  @wrapErrors()
  async getAlgoHourPeriodTotals({ periodStart }: DelegatorContractArgs["getAlgoHourPeriodTotals(uint64)uint64"]): Promise<bigint> {
    const { return: retVal } = await this.readClient.send.getAlgoHourPeriodTotals({ args: { periodStart } })
    return retVal!
  }
}
