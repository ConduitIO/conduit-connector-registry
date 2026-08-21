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
  /**
   * fix/verified-badge-honesty: the badge used to say "Verified" — a claim no
   * code in this build pipeline actually checks (deriveVerified only confirms
   * the signed index *references* a signature + provenance bundle; nothing
   * downloads the artifact or runs cosign). These assertions were updated
   * deliberately, not deleted, to match the corrected, narrower claim.
   */
  it('renders a visible "Signature on file" label when true — never the word "Verified"', () => {
    render(<VerifiedBadge verified={true} />);
    expect(screen.getByText('Signature on file')).toBeTruthy();
    expect(screen.queryByText('Verified')).toBeNull();
  });

  it('renders a neutral "No signature on file" label when false (never a failure-styled label)', () => {
    render(<VerifiedBadge verified={false} />);
    expect(screen.getByText('No signature on file')).toBeTruthy();
  });

  it('wires aria-describedby to the given descriptionId, so a screen reader landing on the badge gets the qualifying text — never a tooltip', () => {
    render(
      <>
        <VerifiedBadge verified={true} descriptionId="signature-note" />
        <p id="signature-note">This site does not cryptographically verify signatures.</p>
      </>
    );
    const badge = screen.getByText('Signature on file').closest('span[aria-describedby]');
    expect(badge?.getAttribute('aria-describedby')).toBe('signature-note');
  });

  it('omits aria-describedby entirely when no descriptionId is given, rather than pointing at nothing', () => {
    render(<VerifiedBadge verified={true} />);
    const badge = screen.getByText('Signature on file').closest('span');
    expect(badge?.hasAttribute('aria-describedby')).toBe(false);
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
