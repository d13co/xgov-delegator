import { SendParams } from "@algorandfoundation/algokit-utils/types/transaction";
import { DelegatorClient, DelegatorComposer } from "./generated/DelegatorClient";
import { XGovDelegatorReaderSDK } from "./sdkReader";
import {
  AccountWithAlgoHours,
  AccountWithOffsetHint,
  CommitteeId,
  CommonMethodBuilderArgs,
  ConstructorArgs,
  DelegatorContractArgs,
  SenderWithSigner,
  SendResult,
} from "./types";
import { getIncreaseBudgetBuilder } from "./util/increaseBudget";
import { requireWriter } from "./util/requiresSender";
import { wrapErrors, wrapErrorsInternal } from "./util/wrapErrors";
import { accountWithAlgoHoursToTuple, accountWithOffsetHintToTuple } from "./util/types";
import { committeeIdToRaw } from "./util/comitteeId";

export class XGovDelegatorSDK extends XGovDelegatorReaderSDK {
  public writerAccount?: SenderWithSigner;
  public writeClient?: DelegatorClient;

  constructor({ writerAccount, ...rest }: ConstructorArgs) {
    super(rest);
    if (writerAccount) {
      this.writerAccount = writerAccount;
      this.writeClient = new DelegatorClient({
        algorand: this.algorand,
        appId: this.appId,
        defaultSender: writerAccount?.sender,
        defaultSigner: writerAccount?.signer,
      });
    }
  }

  // Create an executor from a makeXYZTxn function
  private makeTxnExecutor = <T extends (...args: any) => any, R = SendResult>({
    maker,
    returnTransformer,
    sendParams,
  }: {
    maker: T;
    returnTransformer?: (result: SendResult) => R;
    sendParams?: SendParams;
  }) => {
    return async (args: Parameters<T>[0]): Promise<R> => {
      if (!this.writerAccount) {
        throw new Error(`writerAccount not set on the SDK instance`);
      }
      const result = await wrapErrorsInternal(
        this.execute({
          txnBuilder: (args) => maker.bind(this)(args),
          txnBuilderArgs: args,
          emptyGroupBuilder: () => this.writeClient!.newGroup(),
          sendParams,
        }),
      );
      if (returnTransformer) {
        return returnTransformer(result);
      }
      return result as R;
    };
  };

  // Utility to handle increaseBudget automatically and wrap algod errors
  // gets a standalone group without opup
  // test if need to prepend increaseBudget()
  // if so, remake group with emptyGroupBuilder, passing in a group with increaseBudget() prepended
  private async execute<T extends CommonMethodBuilderArgs, Y extends DelegatorComposer<any>>({
    txnBuilder,
    txnBuilderArgs,
    emptyGroupBuilder,
    sendParams,
  }: {
    txnBuilder: (args: T) => Promise<Y>;
    txnBuilderArgs: T;
    emptyGroupBuilder: () => Y;
    sendParams?: SendParams;
  }) {
    let builder = await txnBuilder(txnBuilderArgs);
    const increasedBudgetBuilder = await getIncreaseBudgetBuilder(
      builder,
      emptyGroupBuilder,
      this.writerAccount!.sender.toString(),
      this.writerAccount!.signer,
      this.algorand.client.algod,
    );
    if (increasedBudgetBuilder) builder = await txnBuilder({ ...txnBuilderArgs, builder: increasedBudgetBuilder });
    return builder.send(sendParams);
  }

  @requireWriter()
  @wrapErrors()
  makeSetCommitteeOracleApp({ appId, builder }: DelegatorContractArgs["setCommitteeOracleApp(uint64)void"] & CommonMethodBuilderArgs) {
    builder = builder ?? this.writeClient!.newGroup();
    builder = builder.setCommitteeOracleApp({ args: { appId } });
    return builder;
  }

  setCommitteeOracleApp = this.makeTxnExecutor({
    maker: this.makeSetCommitteeOracleApp,
  });

  @requireWriter()
  @wrapErrors()
  makeSyncCommitteeMetadata({
    committeeId,
    delegatedAccountsWithOffsetHint,
    builder,
  }: Omit<
    DelegatorContractArgs["syncCommitteeMetadata(byte[32],(address,uint32)[])(uint32,uint32,uint32,(uint32,uint32)[])"],
    "delegatedAccounts" | "committeeId"
  > & { committeeId: CommitteeId, delegatedAccountsWithOffsetHint: AccountWithOffsetHint[] } & CommonMethodBuilderArgs) {
    builder = builder ?? this.writeClient!.newGroup();
    const delegatedAccounts = delegatedAccountsWithOffsetHint.map(accountWithOffsetHintToTuple);
    builder = builder.syncCommitteeMetadata({ args: { committeeId: committeeIdToRaw(committeeId), delegatedAccounts } });
    return builder;
  }

  syncCommitteeMetadata = this.makeTxnExecutor({
    maker: this.makeSyncCommitteeMetadata,
  });

  @requireWriter()
  @wrapErrors()
  makeAddAccountAlgoHours({
    periodStart,
    accountAlgohours,
    builder,
  }: Omit<DelegatorContractArgs["addAccountAlgoHours(uint64,(address,uint64)[])void"], "accountAlgohourInputs"> & {
    accountAlgohours: AccountWithAlgoHours[];
  } & CommonMethodBuilderArgs) {
    builder = builder ?? this.writeClient!.newGroup();
    const accountAlgohourInputs = accountAlgohours.map(accountWithAlgoHoursToTuple);
    builder = builder.addAccountAlgoHours({ args: { periodStart, accountAlgohourInputs } });
    return builder;
  }

  addAccountAlgoHours = this.makeTxnExecutor({
    maker: this.makeAddAccountAlgoHours,
  });

  @requireWriter()
  @wrapErrors()
  makeRemoveAccountAlgoHours({
    periodStart,
    accountAlgohours,
    builder,
  }: Omit<DelegatorContractArgs["removeAccountAlgoHours(uint64,(address,uint64)[])void"], "accountAlgohourInputs"> & {
    accountAlgohours: AccountWithAlgoHours[];
  } & CommonMethodBuilderArgs) {
    builder = builder ?? this.writeClient!.newGroup();
    const accountAlgohourInputs = accountAlgohours.map(accountWithAlgoHoursToTuple);
    builder = builder.removeAccountAlgoHours({ args: { periodStart, accountAlgohourInputs } });
    return builder;
  }

  removeAccountAlgoHours = this.makeTxnExecutor({
    maker: this.makeRemoveAccountAlgoHours,
  });
}
