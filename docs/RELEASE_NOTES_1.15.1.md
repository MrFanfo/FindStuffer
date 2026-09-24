# Findstuff 1.15.1

Category marks are chosen more precisely, and many more of the 177 drawings are
actually reached. No database changes: upgrading from 1.15.0 needs no migration.

## Which mark a category gets

- **A word that only names a grouping gives way to one that names the thing.**
  "Diode Components" is about diodes, so it gets the diode rather than the chip;
  "Resistor Components" gets the resistor.
- **A category's own name outranks the branch it hangs under.** "Electronics >
  Electronic Boards" gets the board rather than the chip it inherits from its
  parent, and only a name that says nothing at all falls back to the branch.
- **Tools, materials, making and household marks are matched too.** Pliers, hex
  keys, calipers, vises, gears, bearings, magnets, zip ties, rope, filament,
  resin, plywood, fabric, foam, cardboard, coffee, tea and the rest now reach
  their own drawings instead of a generic one.

On a tree of 839 categories this moves 149 of the 177 marks into use, with only a
handful left on the neutral tag.

Marks already chosen by hand are untouched: **Suggest marks** still only fills in
categories that have none.
