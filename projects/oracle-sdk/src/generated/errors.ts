// Auto-generated from errors.algo.ts - do not edit manually

/**
 * Map of error codes to human-readable error messages
 */
export const ErrorMessages: Record<string, string> = {
  "ERR:C_EX": "Committee already exists",
  "ERR:C_NX": "Committee does not exist",
  "ERR:PE_LT": "Period end must be greater than period start",
  "ERR:IV_NZ": "Cannot unregister committee with ingested votes (votes must be zero)",
  "ERR:TX_XC": "Total xGovs exceeded",
  "ERR:TV_XC": "Total votes exceeded",
  "ERR:TV_MM": "Total votes mismatch - ingested votes must equal total votes when finished",
  "ERR:NX_XC": "Number of xGovs to uningest exceeds total xGovs",
  "ERR:OOO": "xGovs must be added in ascending order by account ID",
  "ERR:C_NC": "Committee is incomplete - not all votes have been ingested",
  "ERR:A_EX": "Account already exists",
  "ERR:A_NX": "Account does not exist",
  "ERR:AH": "Account hint mismatch - provided offset does not match account",
  "ERR:ID": "Account ID mismatch"
};
