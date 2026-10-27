# New, open and save

> **Where:** command bar → *File* group (**New**, **Open**, **Save**), or the *File* menu · **Keys:**
> Ctrl/⌘ + N, O, S, Shift + S

ParaWerk stores parts in `.pwpart` files with the complete feature history, so every feature stays
editable after reopening.

## Commands

| Command | What it does |
|---|---|
| **New** (Ctrl/⌘ + N) | Starts a new, empty part; asks before discarding unsaved changes |
| **Open** (Ctrl/⌘ + O) | Opens a `.pwpart` file |
| **Save** (Ctrl/⌘ + S) | Saves the part; the first time it asks for a name |
| *File → Save as…* (Ctrl/⌘ + Shift + S) | Saves a copy under a new name |

The window title shows a dot (•) while there are unsaved changes. Double-clicking a `.pwpart` file opens it;
if ParaWerk is running, in the existing window.

## Recovery after a crash

While a part has unsaved changes, ParaWerk writes a recovery copy 15 seconds after a change (also of a
sketch that is still open). Saving or closing normally removes it. After a crash, a power cut or a killed
process, the next start offers it:

![Recovering unsaved work after a crash](../../images/screenshots/recovery.png)

| Button | What it does |
|---|---|
| **Restore** | Opens the copy as an unsaved part; save it to keep it |
| **Discard** | Deletes the copy |
| **Later** | Keeps the copies; they are offered again at the next start |

Recovery copies can be turned off in the [settings](settings.md).

## Messages

| Message | What to do |
|---|---|
| *This is not a ParaWerk part file.* | Choose a `.pwpart` file; for STEP use [Import](import-step.md). |
| *The file was saved by a newer version of ParaWerk.* | Update ParaWerk. |
| *The file is damaged …* / *The file content is invalid …* | Use a backup or the recovery copy. |

## See also

- [Import STEP](import-step.md) · [Export](export.md) · [User guide: Files](../files.md)
