import { describe, it, expect } from 'vitest';
import { redactSecrets } from '../src/redact.js';

// Fixture secrets are assembled at runtime so no secret-shaped literal exists in
// this file — GitHub push protection (rightly) blocks pushes containing them.
const fake = (...parts: string[]) => parts.join('');

describe('redactSecrets', () => {
  it('redacts AWS access keys', () => {
    const key = fake('AKIA', 'IOSFODNN7EXAMPLE');
    const r = redactSecrets(`key is ${key} ok`);
    expect(r.text).toContain('[REDACTED:aws-access-key]');
    expect(r.text).not.toContain('IOSFODNN7');
    expect(r.redactions).toContain('aws-access-key');
  });

  it('redacts stripe and anthropic style keys', () => {
    const stripe = fake('sk_live_', 'abcdefghijklmnopqrstuvwx');
    const anthropic = fake('sk-ant-', 'abc123def456ghi789jkl012');
    const r = redactSecrets(`use ${stripe} and ${anthropic}`);
    expect(r.text).toContain('[REDACTED:stripe-key]');
    expect(r.text).toContain('[REDACTED:anthropic-key]');
  });

  it('redacts connection strings with credentials', () => {
    const r = redactSecrets('db: postgres://admin:hunter22secret@db.example.com:5432/prod');
    expect(r.text).toContain('[REDACTED:connection-string]');
    expect(r.text).not.toContain('hunter22secret');
  });

  it('redacts password assignments', () => {
    const r = redactSecrets(`config had password = "supersecret123"`);
    expect(r.text).toContain('[REDACTED:password-assignment]');
  });

  it('redacts npm tokens and URL credentials', () => {
    const token = ['npm_', 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8'].join('');
    const r = redactSecrets(`published with ${token}, api at https://admin:hunterpass99@api.example.com/v1`);
    expect(r.text).toContain('[REDACTED:npm-token]');
    expect(r.text).toContain('[REDACTED:url-credentials]');
    expect(r.text).not.toContain('hunterpass99');
  });

  it('redacts unquoted password assignments', () => {
    const r = redactSecrets('env had PASSWORD=supersecret123 set');
    expect(r.text).toContain('[REDACTED:password-assignment]');
    expect(r.text).not.toContain('supersecret123');
  });

  it('leaves normal text alone', () => {
    const input = 'Moved checkout server-side and set VITE_STRIPE_USE_SERVER=true in the dashboard.';
    const r = redactSecrets(input);
    expect(r.text).toBe(input);
    expect(r.redactions).toHaveLength(0);
  });
});
