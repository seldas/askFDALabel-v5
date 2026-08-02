import re

with open('frontend/app/drugtox/page.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Remove Changed from interface
content = re.sub(r'\s*Changed:\s*string;', '', content)

# Remove changed_only from axios params
content = re.sub(r'\s*changed_only:\s*changed,', '', content)

# Replace drug.Changed === 'Yes' with false
content = re.sub(r'drug\.Changed === \'Yes\'', 'false', content)

# Replace detail.Changed === 'Yes' with false
content = re.sub(r'detail\.Changed === \'Yes\'', 'false', content)

# Remove the Changed Only switch (we will just remove the FormControlLabel line entirely if it contains changedOnly)
lines = content.split('\n')
new_lines = [line for line in lines if 'changedOnly' not in line or 'Switch' not in line]

with open('frontend/app/drugtox/page.tsx', 'w', encoding='utf-8') as f:
    f.write('\n'.join(new_lines))
