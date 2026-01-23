import { AccountIdContract } from '../base/base.algo'

export class Delegator extends AccountIdContract {
  public hello(name: string): string {
    return `Hello, ${name}`
  }
}
