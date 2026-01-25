import type { Logger } from '../logger';

export type CircuitState = 'closed' | 'open' | 'half-open';

export type CircuitBreakerOptions = {
  failureThreshold: number;
  resetTimeout: number;
  successThreshold: number;
  halfOpenMaxRequests?: number;
  isFailure?: (error: unknown) => boolean;
};

export class CircuitBreakerOpenError extends Error {
  public readonly service: string;

  constructor(service: string, message?: string) {
    super(message || `Circuit breaker for ${service} is open`);
    this.name = 'CircuitBreakerOpenError';
    this.service = service;
  }
}

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime: number | null = null;
  private lastSuccessTime: number | null = null;
  private lastTransitionTime: number = Date.now();
  private openSince: number | null = null;
  private halfOpenInFlight = 0;
  private logger: Logger | null = null;

  constructor(
    private readonly serviceName: string,
    private readonly options: CircuitBreakerOptions,
    logger?: Logger
  ) {
    this.logger = logger ?? null;
  }

  setLogger(logger?: Logger) {
    this.logger = logger ?? null;
  }

  getState(): CircuitState {
    return this.state;
  }

  getStats() {
    return {
      service: this.serviceName,
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      lastTransitionTime: this.lastTransitionTime,
      openSince: this.openSince,
      halfOpenInFlight: this.halfOpenInFlight,
      failureThreshold: this.options.failureThreshold,
      successThreshold: this.options.successThreshold,
      resetTimeout: this.options.resetTimeout,
      halfOpenMaxRequests: this.options.halfOpenMaxRequests ?? 1,
    };
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (this.openSince && Date.now() - this.openSince >= this.options.resetTimeout) {
        this.transitionTo('half-open');
      } else {
        throw new CircuitBreakerOpenError(this.serviceName);
      }
    }

    if (this.state === 'half-open') {
      const maxRequests = this.options.halfOpenMaxRequests ?? 1;
      if (this.halfOpenInFlight >= maxRequests) {
        throw new CircuitBreakerOpenError(
          this.serviceName,
          `Circuit breaker for ${this.serviceName} is half-open`
        );
      }
      this.halfOpenInFlight += 1;
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error);
      throw error;
    } finally {
      if (this.state === 'half-open' && this.halfOpenInFlight > 0) {
        this.halfOpenInFlight -= 1;
      }
    }
  }

  private onSuccess() {
    this.lastSuccessTime = Date.now();

    if (this.state === 'half-open') {
      this.successCount += 1;
      if (this.successCount >= this.options.successThreshold) {
        this.transitionTo('closed');
      }
      return;
    }

    this.failureCount = 0;
  }

  private onFailure(error: unknown) {
    if (this.options.isFailure && !this.options.isFailure(error)) {
      return;
    }

    this.lastFailureTime = Date.now();

    if (this.state === 'half-open') {
      this.transitionTo('open');
      return;
    }

    this.failureCount += 1;
    if (this.failureCount >= this.options.failureThreshold) {
      this.transitionTo('open');
    }
  }

  private transitionTo(state: CircuitState) {
    if (this.state === state) {
      return;
    }

    const previousState = this.state;
    const now = Date.now();
    this.state = state;
    this.lastTransitionTime = now;

    if (state === 'open') {
      this.openSince = now;
      this.successCount = 0;
    }

    if (state === 'half-open') {
      this.failureCount = 0;
      this.successCount = 0;
      this.openSince = null;
      this.halfOpenInFlight = 0;
    }

    if (state === 'closed') {
      this.failureCount = 0;
      this.successCount = 0;
      this.openSince = null;
      this.halfOpenInFlight = 0;
    }

    this.logTransition(previousState, state, now);
  }

  private logTransition(previousState: CircuitState, nextState: CircuitState, timestampMs: number) {
    const context = {
      service: this.serviceName,
      previousState,
      nextState,
      failureCount: this.failureCount,
      successCount: this.successCount,
      timestamp: new Date(timestampMs).toISOString(),
    };

    if (nextState === 'open') {
      this.logger?.warn(context, 'Circuit breaker opened');
      return;
    }

    this.logger?.info(context, 'Circuit breaker state transition');
  }
}
