import { AccountIdContract } from '../base/contract.algo'

export class Delegator extends AccountIdContract {
  public hello(name: string): string {
    return `Hello, ${name}`
  }
}
