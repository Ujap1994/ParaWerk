# Dimension

> **Where:** *Sketch* tab → *Define* group → **Dimension** · **Key:** D · **Needs:** an open sketch

One tool for all dimensions: what it measures follows from what you pick and where you put the value.
Dimensions give the geometry its sizes – change the value, and the geometry follows.

![Placing a dimension: the value is typed right at the dimension](../../images/screenshots/sketch-dimension-value.png)

## Step by step

1. Press **D** or click **Dimension**.
2. Click a line, a circle or an arc – or two entities (points, lines, circles, the origin, an **edge of the
   part**). After the first click, moving over a second entity already shows the dimension between them.
3. Move the mouse: the dimension follows. Click where the value should go.
4. Type the value and press **Enter** (**Esc** keeps the measured value).

## What you get

| You pick | Value placed | Dimension |
|---|---|---|
| A line, or two points | above or below | horizontal distance |
| | left or right | vertical distance |
| | elsewhere | length / direct distance |
| A circle | anywhere | diameter (Ø) |
| An arc | anywhere | radius (R) |
| A point and a line | anywhere | distance from the point to the line |
| Two lines that cross | anywhere | angle (degrees) |
| Two parallel lines | anywhere | distance between them |
| Circles and arcs with points or each other | as for points | distance between the centers |
| A circle and a line | anywhere | distance from the center to the line |
| A point, circle or line and an edge of the part | as above | distance to that edge |

## Editing dimensions

- **Change a value:** double-click the dimension, type, **Enter**.
- **Move the value:** drag it (only the label moves).
- **Delete:** click it and press **Delete**.

## Values

Values can be calculations (`60/3 + 2`, `40*cos(30)`, `pi*10`), carry units (`1in`, `2,5cm`) and use the
part's [variables](variables.md) (`width / 2`): then the dimension follows the variable.

## Tips

- An edge of the part you dimension to becomes fixed construction geometry of the sketch – the usual way
  to place a hole's center 20 mm from the edge of a face.
- A dimension that would **over-define** the sketch is added as a **reference dimension** in parentheses,
  e.g. *(60)*: it shows the value and cannot be edited.
- A sketch is fully defined when all geometry is dark; see [Relations](sketch-relations.md).

![A dimensioned sketch: width, height and diameter](../../images/screenshots/sketch-dimensions.png)

## Messages

| Message | What to do |
|---|---|
| *This dimension would over-define the sketch, so it was added as a reference dimension …* | Fine if you only want to see the value; otherwise delete another dimension that determines it. |
| *The sketch cannot be solved with this value …* | The previous value is kept: check the other dimensions. |
| *Enter a length greater than 0, or an angle between 0 and 180 degrees.* | Correct the value. |
| *Reference dimensions show the measured value and cannot be changed.* | Delete a driving dimension to make it driving. |

## See also

- [Relations](sketch-relations.md) · [Variables](variables.md) · [User guide: Dimensions](../sketches.md#dimensions)
