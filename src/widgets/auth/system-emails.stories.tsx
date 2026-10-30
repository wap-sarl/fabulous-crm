import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import {
  type EmailBrand,
  type EmailContent,
  INVITE_EMAIL,
  LOGIN_EMAIL,
  TEST_EMAIL,
  generateEmailHtml,
} from '../../../convex/auth/emailTemplates';

/** A wordmark drawn in SVG, so the preview needs no hosted file. */
const LOGO =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="32" viewBox="0 0 160 32"><rect width="32" height="32" rx="8" fill="#003c55"/><path d="M9 16h14M16 9v14" stroke="#2dd4bf" stroke-width="3" stroke-linecap="round"/><text x="42" y="22" font-family="Helvetica, Arial, sans-serif" font-size="17" font-weight="700" fill="#14161c">Clinique Nord</text></svg>',
  );

const DEFAULT_BRAND: EmailBrand = {
  organizationName: 'CRM',
  appUrl: 'https://crm.example.com',
};

const CONFIGURED_BRAND: EmailBrand = {
  organizationName: 'Clinique Nord',
  logo: { url: LOGO, width: 160, height: 32 },
  primaryColor: '#003c55',
  appUrl: 'https://crm.clinique-nord.example',
};

const LOGIN_LINK =
  'https://crm.example.com/auth/continue?email=camille.roux%40example.com&otp=482913';

interface PreviewProps {
  content: EmailContent;
  brand: EmailBrand;
  link?: string;
  /** The viewport the mail is read in: a desktop client, or a phone. */
  width: number;
}

/** The mail as a client would show it, in its own document: nothing of the app's stylesheet reaches it. */
function EmailPreview({ content, brand, link, width }: PreviewProps) {
  return (
    <iframe
      title={content.subject}
      srcDoc={generateEmailHtml(content, brand, link)}
      style={{ width, height: 720, border: '1px solid #eaecf0', borderRadius: 8 }}
    />
  );
}

const meta = {
  title: 'E-mails/System e-mails',
  component: EmailPreview,
  args: { content: LOGIN_EMAIL, brand: DEFAULT_BRAND, link: LOGIN_LINK, width: 680 },
  argTypes: { content: { control: false }, brand: { control: false } },
} satisfies Meta<typeof EmailPreview>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The sign-in link, for a deployment that set no logo and no accent: the organisation's name stands as the wordmark, the theme's violet edges the card and fills the button. */
export const Login: Story = {};

/** The same, for a deployment with a logo and its own accent: the button's text stays white as long as the accent is dark enough. */
export const LoginBranded: Story = {
  name: 'Login, branded',
  args: { brand: CONFIGURED_BRAND },
};

/** A light accent: the button's text turns to ink, so it keeps its contrast. */
export const LoginLightAccent: Story = {
  name: 'Login, light accent',
  args: { brand: { ...CONFIGURED_BRAND, primaryColor: '#facc15' } },
};

/** With images off, the logo's place shows the organisation's name; the accent edge is a border, not an image. */
export const LoginImagesOff: Story = {
  name: 'Login, images off',
  args: { brand: { ...CONFIGURED_BRAND, logo: { url: 'https://images.invalid/logo.png' } } },
};

export const Invitation: Story = {
  args: { content: INVITE_EMAIL, brand: CONFIGURED_BRAND, link: CONFIGURED_BRAND.appUrl },
};

/** No action to take: no button, the notes alone under the rule. */
export const TestEmail: Story = {
  name: 'Test e-mail',
  args: { content: TEST_EMAIL, brand: CONFIGURED_BRAND, link: undefined },
};

/** The document inside the preview, once the browser has laid it out. */
const documentOf = async (canvasElement: HTMLElement) => {
  const frame = canvasElement.querySelector('iframe')!;
  await waitFor(() => expect(frame.contentDocument?.querySelector('h1')).not.toBeNull());
  return { frame, doc: frame.contentDocument! };
};

/** On a phone: the card takes the width, the long link breaks, nothing scrolls sideways. */
export const Mobile: Story = {
  name: 'Mobile, 375 px',
  args: { brand: CONFIGURED_BRAND, width: 375 },
  play: async ({ canvasElement }) => {
    const { doc } = await documentOf(canvasElement);
    await expect(doc.documentElement.scrollWidth).toBeLessThanOrEqual(
      doc.documentElement.clientWidth,
    );
    const card = doc.querySelector('.card')!.getBoundingClientRect();
    await expect(card.width).toBeGreaterThan(300);
    await expect(card.right).toBeLessThanOrEqual(375);
  },
};
