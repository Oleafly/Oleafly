# Code signing

The release workflow signs installers automatically **when the secrets below
exist**. Without them it still builds, just unsigned (and the release notes
keep the "first launch unlock" link). Setting this up is a one-time,
account-owner task; nothing in the repo needs to change afterwards.

| Platform | Mechanism | What users get |
| --- | --- | --- |
| macOS | Developer ID certificate + notarization | No Gatekeeper "damaged/unidentified developer" blocks |
| Windows | Azure Trusted Signing (Authenticode) | No SmartScreen "unknown publisher" warnings (reputation builds over the first days) |
| Linux | Tauri updater minisign (already active) | Verified auto-updates; distros don't gate unsigned binaries |

The release job reads each platform's secrets and enables signing only when
they are present, so a fork or a pre-setup build is never blocked.

## macOS (Developer ID + notarization)

1. **Join the Apple Developer Program** ($99/year) at
   [developer.apple.com/programs/enroll](https://developer.apple.com/programs/enroll/).
2. **Create a "Developer ID Application" certificate** in the Apple Developer
   portal (Certificates → +), download it, and open it in Keychain Access so it
   installs into your login keychain.
3. **Export it as a `.p12`**: in Keychain Access, right-click the certificate →
   Export, choose the Personal Information Exchange format, and set a password.
4. **Base64-encode it** for the secret:
   `base64 -i Certificate.p12 | pbcopy`.
5. **Create an app-specific password** for notarization at
   [account.apple.com](https://account.apple.com) → Sign-In and Security →
   App-Specific Passwords.
6. **Set these repository secrets** (Settings → Secrets and variables → Actions):

   | Secret | Value |
   | --- | --- |
   | `APPLE_CERTIFICATE` | base64 of the `.p12` (step 4) |
   | `APPLE_CERTIFICATE_PASSWORD` | the `.p12` export password (step 3) |
   | `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Your Name (TEAMID)` |
   | `APPLE_ID` | your Apple account email |
   | `APPLE_PASSWORD` | the app-specific password (step 5) |
   | `APPLE_TEAM_ID` | the 10-character team id from your membership page |

   The workflow generates `KEYCHAIN_PASSWORD` itself. Notarization is required
   for Developer ID builds and happens automatically once these are set.

## Windows (Azure Trusted Signing)

Azure Trusted Signing (~$10/month) replaces buying and storing an EV/OV
certificate: Microsoft holds the key, you authenticate a service principal, and
`artifact-signing-cli` signs each installer during the build. Individual and
organization identities are both eligible; new accounts have a short validation
period before signing is allowed.

1. **Create the Trusted Signing resources** in the
   [Azure portal](https://portal.azure.com): a Trusted Signing Account and,
   inside it, a Certificate Profile. Note the account name, profile name, and
   the account's endpoint (e.g. `https://wus2.codesigning.azure.net`).
2. **Register an app (service principal)** in Microsoft Entra ID, create a
   client secret, and grant it the **Trusted Signing Certificate Profile
   Signer** role on the signing account.
3. **Set these repository secrets:**

   | Secret | Value |
   | --- | --- |
   | `AZURE_CLIENT_ID` | the app registration's Application (client) ID |
   | `AZURE_TENANT_ID` | your Entra tenant ID |
   | `AZURE_CLIENT_SECRET` | the client secret value |
   | `AZURE_SIGNING_ENDPOINT` | the account endpoint URL |
   | `AZURE_SIGNING_ACCOUNT` | the Trusted Signing account name |
   | `AZURE_SIGNING_PROFILE` | the certificate profile name |

   When `AZURE_CLIENT_ID` is present the release step installs
   `artifact-signing-cli`, writes a `signCommand` overlay config, and passes it
   to the bundler; when it's absent the Windows build stays unsigned.

## Verifying a signed release

- **macOS:** `spctl -a -vvv --type install Oleafly.app` should report
  `source=Notarized Developer ID`; `codesign -dv --verbose=4 Oleafly.app`
  shows the identity.
- **Windows:** right-click the `.msi`/`-setup.exe` → Properties → Digital
  Signatures should list Oleafly, or run
  `Get-AuthenticodeSignature Oleafly_x64-setup.exe` in PowerShell (`Status`
  should be `Valid`).
