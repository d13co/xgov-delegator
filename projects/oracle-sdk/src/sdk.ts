import { CommitteeOracleClient } from "./generated/CommitteeOracleClient";
import { ConstructorArgs, Member, SenderWithSigner, XGovCommitteeFile } from "./types";
import { requireWriter } from "./util/requiresSender";
import { calculateCommitteeId } from "./util/comitteeId";
import { memberToTuple } from "./util/types";
import { XGovCommitteesOracleReaderSDK } from "./sdk-reader";
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
      console.log("Registering committee...");
      const { txIds } = await this.registerCommittee({ committeeId, ...committeeFile });
      console.log("Committee registered ", ...txIds);
    }
    const accounts = committeeFile.xGovs.map(({ address }) => address);
    const accountIds = await this.getAccountIdMap(accounts);
    let accountsInOrder = [...accountIds.entries()]
      .map(([address, id]) => ({ address, id }))
      .sort(({ id: a }, { id: b }) => (a === 0 && b !== 0 ? 1 : a !== 0 && b === 0 ? -1 : a - b));
    for (const { address, id } of accountsInOrder) {
      const votes = committeeFile.xGovs.find((x) => x.address === address)?.votes;
      console.log(`Account: ${address}, ID: ${id}, Votes: ${votes}`);
      if (!votes) {
        throw new Error(`No votes found for account ${address}`);
      }
      console.log(`Ingesting member with ID ${id} and votes ${votes}...`);
      const { txIds } = await this.ingestMembers(committeeId, [{ accountId: id, account: address, votes }]);
      console.log("Member ingested ", ...txIds);
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
  async registerCommittee(...args: Parameters<typeof XGovCommitteesOracleSDK.prototype.makeRegisterCommitteeTxns>) {
    return wrapErrors(() => this.makeRegisterCommitteeTxns(...args).send());
  }

  @requireWriter()
  makeIngestMembersTxns(committeeId: string | Uint8Array, members: Member[]) {
    const { sender, signer } = this.writerAccount!;
    committeeId = typeof committeeId === "string" ? Buffer.from(committeeId, "base64") : committeeId;
    return this.writeClient!.newGroup().ingestMembers({
      args: { committeeId, members: members.map(memberToTuple) },
      sender,
      signer,
    });
  }

  @requireWriter()
  // move wrapping return wrrors in a @wrapErrors() decorator
  async ingestMembers(...args: Parameters<typeof XGovCommitteesOracleSDK.prototype.makeIngestMembersTxns>) {
    const builder = this.makeIngestMembersTxns(...args);
    return wrapErrors(() => builder.send());
  }
}
