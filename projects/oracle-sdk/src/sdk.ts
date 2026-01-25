import { CommitteeOracleClient } from "./generated/CommitteeOracleClient";
import { ConstructorArgs, XGov, SenderWithSigner, XGovCommitteeFile } from "./types";
import { requireWriter } from "./util/requiresSender";
import { calculateCommitteeId } from "./util/comitteeId";
import { xGovToTuple } from "./util/types";
import { XGovCommitteesOracleReaderSDK } from "./sdkReader";
import { wrapErrors } from "./util/wrapErrors";

export class XGovCommitteesOracleSDK extends XGovCommitteesOracleReaderSDK {
  public writerAccount?: SenderWithSigner;
  public writeClient?: CommitteeOracleClient;

  constructor({ writerAccount, ...rest }: ConstructorArgs) {
    super(rest);
    if (writerAccount) {
      this.writerAccount = writerAccount;
      this.writeClient = new CommitteeOracleClient({
        algorand: this.algorand,
        appId: this.appId,
        defaultSender: writerAccount?.sender,
        defaultSigner: writerAccount?.signer,
      });
    }
  }

  @requireWriter()
  async uploadCommitteeFile(committeeFile: XGovCommitteeFile): Promise<Uint8Array> {
    const committeeId = calculateCommitteeId(JSON.stringify(committeeFile));
    const committeeMetadata = await this.getCommitteeMetadata(committeeId);
    if (!committeeMetadata) {
      this.debug && console.log("Registering committee...");
      const { txIds } = await this.registerCommittee({ committeeId, ...committeeFile });
      this.debug && console.log("Committee registered ", ...txIds);
    }
    const accounts = committeeFile.xGovs.map(({ address }) => address);
    const [accountIds, lastIngestedXGov] = await Promise.all([
      this.getAccountIdMap(accounts),
      this.getCommitteeSuperboxDataLast(committeeId),
    ]);
    if (lastIngestedXGov.total) {
      // TODO confirm that last ingested xGov matches expectation
    }
    let accountsInOrder = [...accountIds.entries()]
      .map(([address, id]) => ({ address, id }))
      .sort(({ id: a }, { id: b }) => (a === 0 && b !== 0 ? 1 : a !== 0 && b === 0 ? -1 : a - b));
    accountsInOrder = accountsInOrder.slice(lastIngestedXGov.total ? lastIngestedXGov.total - 1 : 0);
    for (const { address, id } of accountsInOrder) {
      const votes = committeeFile.xGovs.find((x) => x.address === address)?.votes;
      this.debug && console.log(`Account: ${address}, ID: ${id}, Votes: ${votes}`);
      if (!votes) {
        throw new Error(`No votes found for account ${address}`);
      }
      this.debug && console.log(`Ingesting xGov with ID ${id} and votes ${votes}...`);
      const { txIds } = await this.ingestXGovs(committeeId, [{ accountId: id, account: address, votes }]);
      this.debug && console.log("xGov ingested ", ...txIds);
    }
    return committeeId;
  }

  @requireWriter()
  makeRegisterCommitteeTxns({
    committeeId,
    periodStart,
    periodEnd,
    totalMembers,
    totalVotes,
  }: { committeeId: string | Uint8Array } & XGovCommitteeFile) {
    committeeId = typeof committeeId === "string" ? Buffer.from(committeeId, "base64") : committeeId;
    const { sender, signer } = this.writerAccount!;
    return this.writeClient!.newGroup().registerCommittee({
      args: { committeeId, periodStart, periodEnd, totalMembers, totalVotes },
      sender,
      signer,
    });
  }

  @requireWriter()
  @wrapErrors()
  async registerCommittee(...args: Parameters<typeof XGovCommitteesOracleSDK.prototype.makeRegisterCommitteeTxns>) {
    return this.makeRegisterCommitteeTxns(...args).send();
  }

  @requireWriter()
  makeIngestXGovsTxns(committeeId: string | Uint8Array, xGovs: XGov[]) {
    const { sender, signer } = this.writerAccount!;
    committeeId = typeof committeeId === "string" ? Buffer.from(committeeId, "base64") : committeeId;
    return this.writeClient!.newGroup().ingestXGovs({
      args: { committeeId, xGovs: xGovs.map(xGovToTuple) },
      sender,
      signer,
    });
  }

  @requireWriter()
  @wrapErrors()
  async ingestXGovs(...args: Parameters<typeof XGovCommitteesOracleSDK.prototype.makeIngestXGovsTxns>) {
    return this.makeIngestXGovsTxns(...args).send();
  }
}
