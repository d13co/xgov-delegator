import { Contract } from '@algorandfoundation/algorand-typescript'

export class Delegator extends Contract {
  public hello(name: string): string {
    return `Hello, ${name}`
  }
}
