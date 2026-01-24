/**
 * Decorator that ensures the instance has a sender property set before calling the method
 * @returns Method decorator
 */
export function requireSender() {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor): PropertyDescriptor {
    const originalMethod = descriptor.value

    descriptor.value = function (...args: any[]) {
      if (!this || (this as any).sender === undefined) {
        throw new Error(`Method "${propertyKey}" requires a sender to be set on the instance`)
      }

      return originalMethod.apply(this, args)
    }

    return descriptor
  }
}

