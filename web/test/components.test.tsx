import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VerifiedBadge } from '../src/components/VerifiedBadge';
import { EffectiveStatusTag } from '../src/components/EffectiveStatusTag';
import { RevocationBanner } from '../src/components/RevocationBanner';
import { CompatCell } from '../src/components/CompatCell';

/**
 * Guards the never-color-only invariant at the component level (step6-web-ui.md
 * §10): every variant must expose a visible text label and the relevant
 * ARIA role/attribute, not just a color, so the assertions here check text
 * content and roles — never CSS custom property values.
 */

describe('VerifiedBadge', () => {
  it('renders a visible "Verified" label when true', () => {
    render(<VerifiedBadge verified={true} />);
    expect(screen.getByText('Verified')).toBeTruthy();
  });

  it('renders a neutral "Not yet verified" label when false (never a failure-styled label)', () => {
    render(<VerifiedBadge verified={false} />);
    expect(screen.getByText('Not yet verified')).toBeTruthy();
  });
});

describe('EffectiveStatusTag', () => {
  it('renders nothing for "active"', () => {
    const { container } = render(<EffectiveStatusTag status="active" />);
    expect(container.textContent).toBe('');
  });

  it.each([
    ['deprecated', 'Deprecated'],
    ['yanked', 'All versions yanked'],
    ['revoked', 'Revoked'],
  ] as const)('renders a visible label for "%s"', (status, expectedLabel) => {
    render(<EffectiveStatusTag status={status} />);
    expect(screen.getByText(expectedLabel)).toBeTruthy();
  });
});

describe('RevocationBanner', () => {
  it('uses role="alert" (assertive) for revoked — the most severe state', () => {
    render(<RevocationBanner severity="revoked" reason="compromised identity" />);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('compromised identity');
    expect(alert.getAttribute('aria-live')).toBe('assertive');
  });

  it('uses role="status" (polite) for all-versions-yanked — a step down in severity', () => {
    render(<RevocationBanner severity="yanked" reason="all versions had a critical bug" />);
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('all versions had a critical bug');
    expect(status.getAttribute('aria-live')).toBe('polite');
  });
});

describe('CompatCell', () => {
  it('renders an explicit "Available" state, never blank', () => {
    render(
      <table>
        <tbody>
          <tr>
            <CompatCell os="linux" arch="amd64" available={true} />
          </tr>
        </tbody>
      </table>
    );
    expect(screen.getByText(/Available/)).toBeTruthy();
  });

  it('renders an explicit "Not available" state with a request link, never blank', () => {
    render(
      <table>
        <tbody>
          <tr>
            <CompatCell
              os="windows"
              arch="arm64"
              available={false}
              requestUrl="https://example.test/issues"
            />
          </tr>
        </tbody>
      </table>
    );
    expect(screen.getByText(/Not available/)).toBeTruthy();
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe('https://example.test/issues');
  });

  it('renders "Not available" without a link when there is no repository to request against', () => {
    render(
      <table>
        <tbody>
          <tr>
            <CompatCell os="windows" arch="arm64" available={false} />
          </tr>
        </tbody>
      </table>
    );
    expect(screen.getByText(/Not available/)).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });
});
