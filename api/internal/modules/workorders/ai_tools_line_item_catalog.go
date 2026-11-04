package workorders

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

// LineItemCatalogEntry is one typical shop line item with its usual price.
type LineItemCatalogEntry struct {
	Name         string  `json:"name"`
	UnitPrice    float64 `json:"unit_price"`
	QuantityText string  `json:"quantity_text"`
	Notes        string  `json:"notes,omitempty"`
}

// lineItemCatalog lists typical line items and prices, taken from the shop's
// price summary of jobs 29000-31200. Owners can edit this list directly; the
// mass-update prompt uses it so "add a belt kit" gets the usual name and price.
var lineItemCatalog = []LineItemCatalogEntry{
	{Name: "DFL / CA / IA / W / Supplies", UnitPrice: 60, QuantityText: "0.4"},
	{Name: "DFL/L/Supplies", UnitPrice: 60, QuantityText: "0.4"},
	{Name: "DFL/FL/Supplies", UnitPrice: 60, QuantityText: "0.5"},
	{Name: "Capacitor Kit / Shipping", UnitPrice: 77.70, QuantityText: "1"},
	{Name: "Cartridge", UnitPrice: 89.90, QuantityText: "1"},
	{Name: "Belt Kit / Shipping", UnitPrice: 32, QuantityText: "1"},
	{Name: "Belt", UnitPrice: 16.50, QuantityText: "1"},
	{Name: "Screw Joint Modification", UnitPrice: 30, QuantityText: "1"},
	{Name: "Audio Cable", UnitPrice: 25, QuantityText: "1"},
	{Name: "Heatsink / Shipping", UnitPrice: 30, QuantityText: "1"},
	{Name: "Belt & Idler Tyre Kit / Shipping", UnitPrice: 74.50, QuantityText: "1"},
	{Name: "Idler Tyre", UnitPrice: 74.50, QuantityText: "1"},
}

// LineItemCatalog returns a copy of the catalog so callers cannot mutate it.
func LineItemCatalog() []LineItemCatalogEntry {
	out := make([]LineItemCatalogEntry, len(lineItemCatalog))
	copy(out, lineItemCatalog)
	return out
}

// findCatalogEntry matches a name case- and whitespace-insensitively.
func findCatalogEntry(name string) (LineItemCatalogEntry, bool) {
	key := normalizeLookupName(name)
	for _, e := range lineItemCatalog {
		if normalizeLookupName(e.Name) == key {
			return e, true
		}
	}
	return LineItemCatalogEntry{}, false
}

// LineItemCatalogList returns the static catalog. It does not call the LLM.
func (h *Handler) LineItemCatalogList(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"items": LineItemCatalog()})
}

// writeCatalogPromptSection appends the catalog and its usage rule to the
// mass-update prompt.
func writeCatalogPromptSection(b *strings.Builder) {
	b.WriteString("\nLine item catalog (typical prices):\n")
	for _, e := range lineItemCatalog {
		b.WriteString("- ")
		b.WriteString(e.Name)
		b.WriteString(": unit_price ")
		b.WriteString(strconv.FormatFloat(e.UnitPrice, 'f', -1, 64))
		b.WriteString(", quantity_text ")
		b.WriteString(e.QuantityText)
		b.WriteString("\n")
	}
	b.WriteString("When the instruction adds an item that matches a catalog entry (e.g. 'a belt kit' -> 'Belt Kit / Shipping'), " +
		"use the catalog name exactly, and use its unit_price and quantity_text unless the instruction gives a price or quantity.\n")
}
