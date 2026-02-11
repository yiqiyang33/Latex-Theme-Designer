# UI Selector Hotfix Manual Checklist

Use this checklist after UI changes touching selector rendering/state.

## Preconditions
- Start server: `python3 tools/latex_toolkit.py --port 8877`
- Open: `http://127.0.0.1:8877`
- Hard refresh once to avoid stale browser cache.

## Selector Availability
- `Template` dropdown has options and is clickable.
- `Source` dropdown has options and is clickable.
- `Compile` dropdown has options and is clickable.
- `Recipe` dropdown has options and is clickable.
- None of the four dropdowns is disabled when options are present.

## State Stability
- Change all four dropdowns to non-default values where possible.
- Click `Apply Target` and verify selected `Target` is preserved.
- Toggle fallback on, click `Apply Recipe`, verify `Recipe` dropdown remains enabled.
- Toggle fallback off, click `Apply Recipe`, verify selected `Recipe` is preserved.
- Click `Save Overrides`, verify all selected dropdown values remain unchanged.
- Enable `Dry run`, click `Split Current Target`, verify selected dropdown values remain unchanged.
- Click `Compile PDF` (success/failure both acceptable), verify selected dropdown values remain unchanged.

## Expected Result
- No JavaScript syntax/runtime errors in browser console.
- Dropdown state remains consistent across rerenders and API refreshes.
