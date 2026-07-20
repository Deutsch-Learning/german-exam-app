Please review the authentication and session-management logic across the entire project.

Currently, there appears to be a mechanism that logs users out automatically after a certain period. I do not remember exactly where or when it was implemented. Locate all code responsible for automatic logout, session expiration, inactivity timers, token deletion, and authentication persistence.

Update the system so that users remain logged in normally after signing in. Their session should persist across:

* Page refreshes
* Closing and reopening the browser
* Closing and reopening the application
* Normal periods of inactivity
* Navigation between pages

Do not unnecessarily delete access tokens, refresh tokens, cookies, local storage data, or Supabase authentication sessions.

The user should only be logged out in the following situations:

1. The user explicitly clicks the **Log out / Se déconnecter** button.
2. The authentication provider determines that the session is no longer valid and it cannot be refreshed.
3. The user has been completely inactive for at least **24 consecutive hours**, if an inactivity-security mechanism is required.

For the 24-hour inactivity rule:

* Track genuine user activity, such as clicks, touches, keyboard input, scrolling, or application usage.
* Reset the inactivity timer whenever genuine activity is detected.
* Do not calculate inactivity only from the time the user originally logged in.
* Do not log the user out while they are actively using the application.
* Store the last activity timestamp persistently so the rule continues to work after refreshing or reopening the application.
* Before logging out, verify that the stored inactivity period has genuinely exceeded 24 hours.
* Avoid creating multiple timers or event listeners.
* Properly clean up timers and listeners when components are unmounted.

Preserve the normal authentication refresh mechanism. When an access token expires, the application should attempt to renew it using the refresh token rather than immediately disconnecting the user.

If the project uses Supabase Auth, ensure that:

* Session persistence is enabled.
* Automatic token refreshing is enabled.
* The existing session is recovered when the app starts.
* `signOut()` is not triggered merely because an access token has expired.
* Temporary network errors do not immediately log the user out.
* Authentication state listeners do not create logout loops.
* The session is cleared only after an explicit logout, a confirmed unrecoverable authentication failure, or more than 24 hours of genuine inactivity.

Also search for and correct any conflicting logic in authentication providers, route guards, middleware, layouts, hooks, context files, API interceptors, local-storage utilities, and mobile app lifecycle handlers.

Do not remove authentication security or break protected routes. Keep unauthorized users blocked from protected pages, while allowing authenticated users to maintain a stable, persistent session.

After implementing the correction, test these scenarios:

1. Log in and refresh the page — the user must remain logged in.
2. Close and reopen the browser or app — the user must remain logged in.
3. Check if the user Leaves the app inactive for a few minutes or several hours — the user must remain logged in.
4. Allow an access token to expire — it should refresh automatically without disconnecting the user.
5. Temporarily lose the internet connection — the user should not be immediately logged out.
6. Return before 24 hours of inactivity — the session should continue and the inactivity timer should reset.
7. Exceed 24 consecutive hours of genuine inactivity — the user may then be securely logged out.
8. Click the logout button — the session and relevant authentication data should be correctly cleared.

Make the smallest safe changes necessary. Do not alter unrelated features, UI components, payment flows, exam data, or other existing application behavior.

Please also review and fully repair the **Google authentication** functionality on both the login and registration pages.

Google authentication is currently displayed in the interface, but it does not work correctly. Configure and implement it properly so that users can securely create an account or sign in by clicking the Google authentication button.

## Required Google authentication behaviour

On the registration page, display a clear button such as:

**Continue with Google**

When a new user clicks it:

1. Start the Google OAuth authentication flow.
2. Allow the user to select or sign in to their Google account.
3. Redirect them securely back to the application after successful authentication.
4. Automatically create their application account using the information returned by Google.
5. Save the required user profile data in the existing user profile or database structure.
6. Establish a persistent authenticated session.
7. Redirect the user to the correct onboarding page or dashboard.

On the login page, display the same consistent button:

**Continue with Google**

When an existing user clicks it:

1. Authenticate the user through Google.
2. Recover the corresponding existing application account.
3. Establish the authenticated session.
4. Redirect the user to the correct dashboard or intended protected page.

The same Google OAuth flow may handle both registration and login. The system should automatically determine whether the authenticated Google user is new or already has an account.

Do not create duplicate accounts every time the user signs in with Google.

## Account linking and duplicate prevention

Use the verified Google email address as part of the account-matching process.

If a user previously registered manually with the same verified email address, handle the situation safely according to the authentication provider’s supported account-linking behaviour. Do not silently create two separate accounts for the same person.

Preserve existing application data, subscriptions, exam access, payment records, progress, roles, and user settings when an account is matched or linked.

Do not implement unsafe manual account merging.

## Remove GitHub authentication

Completely remove the **Continue with GitHub**, **Login with GitHub**, or **Register with GitHub** option from:

* The login page
* The registration page
* Authentication modals
* Mobile layouts
* Desktop layouts
* Authentication configuration
* OAuth provider lists
* Related unused UI components

Remove unused GitHub authentication code only when it is no longer referenced elsewhere. Do not remove GitHub-related functionality used for project development, repository integration, or unrelated application features.

## Google OAuth configuration

Inspect the current authentication implementation and verify all required configuration, including:

* Google OAuth provider activation
* Google client ID
* Google client secret
* Authorized JavaScript origins
* Authorized redirect URIs
* Supabase callback URL, if Supabase Auth is used
* Development URL
* Production URL
* Preview or staging URLs, where applicable
* Environment variables
* Authentication callback route
* Route guards
* Session recovery after redirect
* Error handling
* Mobile and desktop compatibility

Do not expose the Google client secret or any private authentication credentials in frontend code.

Use environment variables and the project’s existing secure configuration system.

If Supabase Auth is used, implement the OAuth call through the official supported method, such as `signInWithOAuth`, with the Google provider and the correct redirect URL.

Ensure the authentication callback is processed correctly and that the user’s session is recovered before redirecting them to a protected page.

## Redirect behaviour

Use the correct redirect URL for each environment instead of hardcoding only localhost or only the production domain.

After successful authentication:

* A new user should be sent to any required onboarding or profile-completion page.
* An existing user should be sent to the dashboard or the page they originally attempted to access.
* A user must not remain stuck on the callback page.
* A user must not be redirected repeatedly between the login page and dashboard.
* A user must not briefly appear logged out while the session is still being restored.

When authentication is cancelled or fails, return the user safely to the login or registration page and show a concise, understandable error message.

Do not display raw provider errors, internal stack traces, callback parameters, or technical OAuth messages to the user.

## User profile creation

When a user signs in through Google for the first time, populate the existing profile structure with available information such as:

* Full name
* Email address
* Google profile image, where supported
* Authentication provider
* Account creation date

Do not overwrite user-editable profile information on every login.

Only use Google profile data to initialize missing information or where an explicit synchronization rule already exists.

Make sure any database trigger or profile-creation function works for both email/password users and Google-authenticated users.

## UI and design improvements

Since GitHub authentication is being removed, improve the presentation of the Google authentication option so the login and registration pages remain visually balanced and complete.

The Google button should:

* Use the official Google icon correctly.
* Be prominent without overpowering the email and password form.
* Fill the appropriate available width of the authentication form.
* Have consistent height, padding, border radius, typography, and spacing.
* Be fully responsive on mobile, tablet, and desktop.
* Have proper hover, focus, pressed, loading, success, and disabled states.
* Clearly indicate that authentication is in progress after it is clicked.
* Prevent repeated clicks while the OAuth request is starting.
* Remain inside the authentication card without overflowing.
* Respect the project’s existing design system, light mode, and dark mode.

Use a clean separator between social authentication and manual authentication, such as:

**or continue with email**

Do not leave a large empty area where the GitHub button previously appeared. Rebalance spacing and alignment after removing it.

Use the same Google button design and terminology on both the registration and login pages so users understand that Google can be used for either action.

## Loading and error protection

When the Google button is clicked:

* Disable it temporarily.
* Show a small loading indicator.
* Do not trigger multiple OAuth requests.
* Restore the button if the request cannot begin.
* Show a user-friendly message if authentication fails.
* Handle popup blocking, cancelled authentication, invalid callback state, and temporary network errors gracefully.

Do not automatically log out an already authenticated user because of a temporary OAuth or network error.

## Security requirements

Preserve OAuth security protections, including:

* State validation
* PKCE, where supported
* Secure callback handling
* HTTPS in production
* Safe redirect validation
* Protection against open redirects
* Secure session storage
* Automatic token refresh
* Persistent sessions

Never place access tokens, refresh tokens, authorization codes, client secrets, or sensitive authentication data in visible URLs, logs, analytics events, or error messages.

## Testing requirements

After implementation, test all of the following:

1. A completely new user registers through Google.
2. The new Google user’s profile is created correctly.
3. The new user is redirected to onboarding or the correct dashboard.
4. An existing Google user signs in without creating a duplicate account.
5. A user refreshes the page after Google login and remains authenticated.
6. A user closes and reopens the browser or app and remains authenticated.
7. A user cancels the Google account-selection screen.
8. A temporary network failure produces a clear error without breaking the page.
9. The Google button cannot be clicked repeatedly while loading.
10. GitHub authentication no longer appears anywhere in the user-facing authentication interface.
11. Mobile and desktop layouts remain properly aligned after GitHub is removed.
12. The Google callback works in development and production.
13. Existing email-and-password registration and login continue working.
14. Existing users retain their subscriptions, exam access, progress, roles, and payment history.
15. Protected routes correctly recognize the restored Google session.

Make the smallest safe changes necessary. Do not redesign unrelated pages or alter existing payment, subscription, examination, or user-access logic.

Please also review and improve the **10-second transition screen between exam Teile**.

Currently, in some parts of the exams or certification, when the user finishes one Teil and moves to the next, a 10-second countdown is displayed before the next Teil begins. Keep this behaviour, because it is useful, but improve both its usability and mobile presentation.

## Add a Skip button

When the 10-second countdown starts, display a clear button below the timer:

**Skip**
or, if the interface is in German:

**Überspringen**

When the user clicks this button:

* Stop the countdown immediately.
* Prevent the timer from continuing in the background.
* Prevent the transition from being triggered twice.
* Open the next Teil immediately.
* Preserve all already saved answers and progress.
* Do not reload or reset the exam unnecessarily.

The button should be visible throughout the countdown, including during the final second.

Once the user clicks it, disable it immediately to prevent repeated clicks.

## Correct the mobile and Android positioning

Currently, on some Android phones and mobile layouts, the countdown appears near the top of the full page instead of appearing in the user’s current visible screen area.

For example, when the user is scrolled near the bottom of a long exam page and the transition starts, the countdown may appear above the current viewport, forcing the user to scroll upward to see it.

Fix this completely.

The countdown must appear as a true viewport-level modal or overlay, centered directly on the part of the screen currently visible to the user, regardless of:

* The page scroll position
* The height of the previous Teil
* The mobile browser viewport
* Android browser controls
* The device orientation
* The user’s current position inside the page

Do not position the countdown relative to the exam content container or document flow.

Use a proper fixed overlay attached to the viewport, such as a fixed-position modal layer with full-screen bounds and a sufficiently high z-index.

The overlay should remain centered even when the user was previously scrolled to the bottom of the page.

## Recommended presentation

The transition should appear as a compact, polished modal or full-screen overlay containing:

* A short message indicating that the next Teil is about to begin
* The name or number of the upcoming Teil, where available
* A clearly visible countdown number
* The **Skip / Überspringen** button
* subtle progress animation

Example German wording:

**Der nächste Teil beginnt in 10 Sekunden.**

The number should update smoothly from 10 to 0.

The interface should be visually balanced and not excessively large.

On mobile, all content should fit within the visible viewport without requiring scrolling.

Respect safe-area insets on devices with notches, rounded corners, or browser navigation bars.

## Interaction behaviour

While the transition overlay is visible:

* Prevent accidental interaction with the previous Teil behind it.
* Prevent the user from answering or changing questions in the background.
* Avoid accidental page scrolling.
* Preserve the current exam state.
* Do not allow browser back actions or duplicate navigation to corrupt the exam flow.
* Do not start the next Teil more than once.

The next Teil should begin when either:

1. The countdown reaches zero, or
2. The user clicks **Skip / Überspringen**.

Both paths must use the same transition function so that behaviour remains consistent.

## Timer cleanup

Review the countdown implementation carefully and ensure that:

* Only one countdown interval or timeout exists at a time.
* The interval is cleared when the countdown reaches zero.
* The interval is cleared when the user clicks Skip.
* The interval is cleared when the component unmounts.
* The next Teil cannot be opened twice.
* Returning to the exam does not restart an already completed transition.
* Rapid taps do not create duplicate navigation events.

Use proper state or refs to guard against repeated execution.

## Responsive design requirements

Test and correct the overlay on:

* Small Android phones
* Large Android phones
* iPhones
* Tablets
* Desktop browsers
* Portrait orientation
* Landscape orientation
* Pages with significant vertical scrolling

The modal must remain visible, centered, readable, and fully usable in every case.

Do not redesign unrelated exam pages. Only improve the transition overlay, add the Skip button, and correct its positioning and behaviour without breaking the current exam flow.
