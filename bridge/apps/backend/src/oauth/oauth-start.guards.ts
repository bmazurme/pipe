import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

// Forwards ?state=… (set only by the "connect" flow) to the provider and
// back to the callback; a plain login has none and passes through unchanged.
function stateOptions(context: ExecutionContext): { state?: string } {
  const { query } = context
    .switchToHttp()
    .getRequest<{ query: { state?: unknown } }>();

  return typeof query.state === 'string' ? { state: query.state } : {};
}

@Injectable()
export class YandexStartGuard extends AuthGuard('yandex') {
  getAuthenticateOptions(context: ExecutionContext) {
    return stateOptions(context);
  }
}

@Injectable()
export class GithubStartGuard extends AuthGuard('github') {
  getAuthenticateOptions(context: ExecutionContext) {
    return stateOptions(context);
  }
}
