# Configurations

> **Where:** *Evaluate* tab → *Part* group → **Configurations** · **Needs:** [variables](variables.md) for
> the dimensions that change

Configurations are variants of one part in one file – a mounting plate in three sizes, a bracket with and
without a hole. Each configuration remembers the values of the part's variables and which features are
suppressed.

![The design table of a mounting plate in three sizes](../../images/screenshots/configurations.png)

## Step by step

1. Give the dimensions that change between the variants a [variable](variables.md) (in feature parameters
   or sketch dimensions).
2. Click **Configurations** and **Add configuration**. It starts as a copy of the part as it is now and is
   shown; the first time, the part as it was is kept as *Default*.
3. Change variables or suppress features as usual – or change the cells of the **design table** in the
   dialog: each row is a configuration, each column a variable (equations work too, such as
   `width / 20`).
4. Switch between configurations with the radio button in the dialog or the switch at the top of the
   feature tree.

## The dialog

| Column / button | What it does |
|---|---|
| *Shown* (radio button) | Shows that configuration |
| *Name* | The name of the configuration (must be unique) |
| one column per variable | Its value or equation in that configuration |
| bin | *Delete configuration* |
| **Add configuration** | A new configuration as a copy of the part as it is now |

## Tips

- Changes to the part belong to the configuration that is shown.
- Switching is one undo step; exports and mass properties use the configuration that is shown.

## Messages

| Message | What to do |
|---|---|
| *The part has no variables yet …* | Add variables under **Features → Variables** first. |
| *Another configuration has that name already.* | Choose a different name. |

## See also

- [Variables](variables.md) · [Feature tree](feature-tree.md) (suppress) · [User guide: Configurations](../features.md#configurations)
