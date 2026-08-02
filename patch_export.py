import re

path = r"d:\Coding\askFDALabel\frontend\app\drugtox\page.tsx"
with open(path, "r", encoding="utf-8") as f:
    text = f.read()

# 1. Remove state
state_pattern = r"  const \[exportMostRecentSpls, setExportMostRecentSpls\] = useState\(true\);\n"
text = re.sub(state_pattern, "", text)

# 2. Remove checkbox UI
checkbox_pattern = r"""                <FormControlLabel
                  control={
                    <Switch
                      checked={exportMostRecentSpls}
                      onChange={(e) => setExportMostRecentSpls(e.target.checked)}
                      color="primary"
                    />
                  }
                  label={
                    <Box>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>Filter: Most Recent SPLs Only</Typography>
                      <Typography variant="caption" color="text.secondary">Excludes historical documents when unchecked</Typography>
                    </Box>
                  }
                />"""
text = text.replace(checkbox_pattern, "")

# 3. Remove from API call payload
api_pattern = r"                    most_recent_spls: exportMostRecentSpls,\n"
text = re.sub(api_pattern, "", text)

with open(path, "w", encoding="utf-8") as f:
    f.write(text)

print("Removed exportMostRecentSpls from frontend")
