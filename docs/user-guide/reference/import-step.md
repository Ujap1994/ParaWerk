# Import STEP

> **Where:** command bar → *Exchange* group → **Import**, or *File → Import STEP…* · **Needs:** a STEP file
> (`.step`, `.stp`) with solids

Import reads the solids of a STEP file as a feature of the part: a purchased part to build around, a part
from another CAD system to continue in ParaWerk.

![An imported STEP file in the side panel](../../images/screenshots/import-step.png)

## Step by step

1. Click **Import** and choose the STEP file.
2. The import is inserted at the rollback bar; the side panel shows the file and its size.
3. Choose **Add material** (a body of its own, or joined with the part) or **Remove material** (cut out of
   the part, e.g. a purchased part's envelope).
4. Click **✓**.

## Options

| Field | What it does | Default |
|---|---|---|
| *File* | The file name and size | |
| *Replace with another STEP file…* | Exchanges the file | |
| *Operation* | **Add material** or **Remove material** | Add material |
| *Merge result (with the bodies it touches)* | Cleared, the import stays a body of its own | on |

## Tips

- The file is kept **in the part**: the part opens without it, and later changes of the file do not reach the
  part (replace it in the side panel).
- Faces of imported solids get names of their own, so fillets, sketches on faces and reference geometry on
  them stay put.
- Surfaces and wireframes are left out; files up to 64 MB are imported.

## Messages

| Message | What to do |
|---|---|
| *The STEP file contains no solid body …* | Export solids from the other system. |
| *Import failed: the file is larger than 64 MB* | Simplify the file. |
| *Import failed: this is not a STEP file (ISO 10303-21)* | Choose a STEP file. |

## See also

- [Export](export.md) · [User guide: Import STEP](../files.md#import-step)
