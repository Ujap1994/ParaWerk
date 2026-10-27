# Variables

> **Where:** *Features* tab → **Variables** · **Needs:** nothing

Variables are named values for the whole part – a width, a wall thickness, a hole diameter – that
dimensions and feature parameters can use by name. Change the variable, and everything that uses it
follows.

![The variables of a part: values and equations with their results](../../images/screenshots/variables.png)

## Step by step

1. Click **Variables**. The side panel shows the list (a new part has none; the list sits at the top of
   the feature tree).
2. Click **Add variable**, type a *Name* and a *Value or equation* (`120`, `width / 2`). The *Result*
   column shows what it comes to.
3. Click **✓** (it stays disabled until every row is valid).
4. Use the variable: type its name, or an equation with it, into a parameter field or a sketch dimension
   instead of a number – `width`, `depth - 2*thickness`.

To change a value later, open **Variables** again (or double-click *Variables* in the tree), change it and
click **✓**: every parameter and sketch dimension that uses it follows, in one undo step.

![A box whose width, depth and height follow variables](../../images/screenshots/variables-parameters.png)

## Options

| Column | What it holds |
|---|---|
| *Name* | Starts with a letter or `_`, then letters, digits and `_`; upper and lower case do not matter |
| *Value or equation* | A number or a calculation with other variables |
| *Result* | The value it comes to, or what is wrong |
| bin | *Remove variable* |

## What equations can use

| | |
|---|---|
| Arithmetic | `+ - * /` (also `× ÷ −`), powers `^`, brackets |
| Units | `mm`, `cm`, `m`, `in` or `"` after a number or a bracket (`2 in`, `(a + 3) cm`) |
| Functions | `sqrt`, `abs`, `sin`, `cos`, `tan`, `asin`, `acos`, `atan` (degrees), `round`, `floor`, `ceil`, `pi` |
| Several values | `min(a; b; …)`, `max(a; b; …)` |
| Choices | `if(condition; then; else)` with `<`, `>`, `<=`, `>=`, `=`, `<>` – e.g. `if(length > 100; 8; 5)` |

Arguments are separated by `;`. A comma between digits is a decimal separator (`2,5`).

## Tips

- A parameter that uses a variable keeps the equation and shows its result below the field; typing a plain
  number makes it a fixed value again.
- The count of a [pattern](pattern.md) takes an equation too, e.g. `floor(length / 30)`; it is rounded to a
  whole number of at least 2.
- [Configurations](configurations.md) give the variables different values per variant.
- Units and functions (`mm`, `sin`, `pi`, …) cannot be variable names.

## Messages

| Message (in the row) | What to do |
|---|---|
| *Names start with a letter and use letters, digits and _ …* | Rename the variable. |
| *Another variable has this name.* | Use a different name. |
| *This is not a valid value or equation.* | Check brackets and operators. |
| *Uses a name that is not a variable.* | Add the variable or fix the typing. |
| *Depends on itself (through other variables).* | Break the circle. |
| *n sketches could not follow the new values and kept their previous state.* (toast) | A sketch cannot be solved with the new values: check its dimensions. |

## See also

- [Configurations](configurations.md) · [Sketch dimensions](sketch-dimension.md)
- [User guide: Variables and equations](../features.md#variables-and-equations)
