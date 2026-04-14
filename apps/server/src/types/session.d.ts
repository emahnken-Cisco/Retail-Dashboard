import "fastify";

declare module "fastify" {
  interface Session {
    userId?: string;
    oidcNonce?: string;
    oidcState?: string;
    oidcCodeVerifier?: string;
  }
}
