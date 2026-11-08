import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';

const LEGAL_DRAFT = true;
const LEGAL_LAST_UPDATED = '8 November 2026';

const confirm = (text) => `[Owner to confirm: ${text}]`;

const LEGAL_DOCUMENTS = {
  privacy: {
    path: '/privacy',
    title: 'Privacy Policy',
    description: 'What Skribe stores, which services process it, and the choices you have.',
    sections: [
      {
        heading: 'Who runs Skribe',
        body: [`Skribe is a collaborative whiteboard in public beta, operated by ${confirm('the name of the person or organisation operating Skribe')}. Questions about this policy can be sent to ${confirm('a contact email address')}.`]
      },
      {
        heading: 'What we store',
        body: [
          'Your account: your name, your email address and your password. Passwords are stored only as a one-way bcrypt hash, never in readable form.',
          'Your boards: the title, everything you place on a board, the list of people the board is shared with, and a short history of recent changes used to keep collaborators in sync.',
          'Images you upload to a board, and your display preferences.',
          'Technical records created by our hosting providers when your browser talks to Skribe, such as IP address, browser type, the address requested and the time.'
        ]
      },
      {
        heading: 'How we use it',
        body: [
          'To run Skribe: to sign you in, save and sync your boards, share them with the people you choose, and keep the service secure, for example by limiting repeated sign-in attempts.',
          'Skribe does not show advertising, does not sell personal information and does not use analytics or advertising trackers.'
        ]
      },
      {
        heading: 'Services that process your information',
        body: [
          `MongoDB Atlas stores account and board data. ${confirm('the hosting region of the production database')}`,
          'ImageKit stores and delivers images you upload. New uploads are stored as private files and shown through links that expire.',
          'Groq processes requests when you use AI features. What you send is the request itself and the board content it needs: your prompt, text from the board, and for Mess Cleanup a picture of the board. Nothing is sent to Groq unless you use one of these features.',
          'Cloudflare serves the Skribe website and app, and Railway runs the Skribe server. Both handle the technical records described above.',
          'Fonts and icons are loaded from Google Fonts, so Google receives your IP address when the pages load.',
          'Voice features use your browser\'s built-in speech recognition. In Google Chrome, your browser sends the audio to Google to turn it into text.',
          'Sign-in with Google is not currently offered.'
        ]
      },
      {
        heading: 'Sharing a board',
        body: ['When you share a board, the people you add can see and edit everything on it. If the owner removes someone, they lose access to the board straight away.']
      },
      {
        heading: 'Storage in your browser',
        body: [
          'Skribe sets one cookie, which keeps you signed in. It cannot be read by scripts on the page and is not used for tracking.',
          'Your browser also keeps edits that have not been saved yet, and your display preferences, in local storage so that work is not lost if the page closes. These stay on your device until they are saved or removed.'
        ]
      },
      {
        heading: 'How long we keep information',
        body: [
          confirm('how long accounts, boards, deleted boards, uploaded images and hosting logs are kept'),
          'Currently, a deleted board is kept for 30 days before images used only on that board become eligible for removal.'
        ]
      },
      {
        heading: 'Your choices',
        body: [
          'You can edit or delete your boards at any time, and remove people from boards you own.',
          `To ask for a copy of your information or for your account to be deleted, contact ${confirm('a contact email address')}.`
        ]
      },
      {
        heading: 'Security',
        body: ['Skribe uses encrypted connections, stores passwords as one-way hashes, limits repeated sign-in attempts and shows uploaded images through links that expire. No online service can promise perfect security, and Skribe is still in beta.']
      },
      {
        heading: 'Children',
        body: [confirm('the minimum age for using Skribe')]
      },
      {
        heading: 'Changes to this policy',
        body: ['If this policy changes, the new version will be posted on this page with a new date.']
      }
    ]
  },
  terms: {
    path: '/terms',
    title: 'Terms of Service',
    description: 'The rules for using the Skribe public beta.',
    sections: [
      {
        heading: 'About these terms',
        body: [`These terms apply when you use Skribe, a collaborative whiteboard operated by ${confirm('the name of the person or organisation operating Skribe')}. By creating an account you agree to them.`]
      },
      {
        heading: 'Skribe is in public beta',
        body: ['Features may change, be removed or be temporarily unavailable while Skribe is in beta. Keep your own copies of anything important.']
      },
      {
        heading: 'Your account',
        body: ['Give accurate details when you sign up, keep your password private and tell us if you think someone else is using your account. You are responsible for what happens under your account.']
      },
      {
        heading: 'Your content',
        body: [
          'What you put on your boards stays yours.',
          'You allow Skribe to store, display and process your content as needed to run the service, including sending it to the providers listed in the Privacy Policy when you use features that need them, such as AI features.',
          'Only upload content you have the right to share.'
        ]
      },
      {
        heading: 'Sharing and collaboration',
        body: ['Board owners decide who can see and edit a board. Anyone you add can see and change its contents.']
      },
      {
        heading: 'Acceptable use',
        body: ['Do not use Skribe to break the law, harass people, share harmful or infringing material, try to reach other people\'s accounts or boards without permission, or disrupt the service.']
      },
      {
        heading: 'AI features',
        body: ['AI features can produce wrong or incomplete results. Check anything they generate before you rely on it.']
      },
      {
        heading: 'Ending your use',
        body: ['You can stop using Skribe at any time. Accounts that break these terms may be suspended or closed.']
      },
      {
        heading: 'Liability and governing law',
        body: [confirm('limitation of liability, warranty wording and governing law, after legal review')]
      },
      {
        heading: 'Contact and changes',
        body: [`Questions about these terms can be sent to ${confirm('a contact email address')}. If the terms change, the new version will be posted on this page with a new date.`]
      }
    ]
  }
};

const setMeta = (selector, attribute, value) => {
  let element = document.head.querySelector(selector);
  if (!element) {
    element = document.createElement(selector.startsWith('link') ? 'link' : 'meta');
    if (selector.startsWith('link')) element.setAttribute('rel', 'canonical');
    else element.setAttribute('name', 'description');
    document.head.appendChild(element);
  }
  const previous = element.getAttribute(attribute);
  element.setAttribute(attribute, value);
  return () => { if (previous !== null) element.setAttribute(attribute, previous); };
};

export const LegalPage = ({ kind }) => {
  const doc = LEGAL_DOCUMENTS[kind];

  useEffect(() => {
    const previousTitle = document.title;
    document.title = `${doc.title} · Skribe`;
    const restoreDescription = setMeta('meta[name="description"]', 'content', doc.description);
    const restoreCanonical = setMeta('link[rel="canonical"]', 'href', `https://skribe.stream${doc.path}`);
    return () => {
      document.title = previousTitle;
      restoreDescription();
      restoreCanonical();
    };
  }, [doc]);

  return (
    <main className="min-h-screen bg-surface text-on-surface">
      <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
        <nav className="mb-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm font-medium">
          <Link to="/" className="text-primary hover:underline">Skribe home</Link>
          <Link to={kind === 'terms' ? '/privacy' : '/terms'} className="text-primary hover:underline">{kind === 'terms' ? 'Privacy Policy' : 'Terms of Service'}</Link>
        </nav>
        {LEGAL_DRAFT && (
          <p role="note" className="mb-8 rounded-xl border-2 border-outline bg-surface-container px-4 py-3 text-sm">
            Draft for review. This page is not final until the items marked &quot;Owner to confirm&quot; are completed.
          </p>
        )}
        <h1 className="font-headline text-3xl font-bold sm:text-4xl">{doc.title}</h1>
        <p className="mt-2 text-sm text-on-surface-variant">Last updated {LEGAL_LAST_UPDATED}</p>
        {doc.sections.map((section) => (
          <section key={section.heading} className="mt-8">
            <h2 className="font-headline text-xl font-bold">{section.heading}</h2>
            {section.body.map((paragraph) => (
              <p key={paragraph} className="mt-3 leading-relaxed text-on-surface-variant">{paragraph}</p>
            ))}
          </section>
        ))}
      </div>
    </main>
  );
};

export default LegalPage;
