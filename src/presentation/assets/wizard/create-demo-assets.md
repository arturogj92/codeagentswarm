# Creating Demo Assets for Wizard

## Required Assets

### 1. terminals-demo.mp4 / terminals-demo.gif
**Content**: Show 4 terminals with different tasks running
- Duration: 8-10 seconds
- Show switching between terminals
- Show different projects/tasks in each
- Highlight the terminal indicators (1, 2, 3, 4)

### 2. kanban-demo.gif
**Content**: Animated Kanban board interaction
- Duration: 5-7 seconds
- Show dragging a task from "Pending" to "In Progress"
- Show task details popup
- Show project color coding

### 3. git-commit-demo.mp4 / git-commit-demo.gif
**Content**: AI generating a commit message
- Duration: 10-12 seconds
- Show git status with changes
- Show AI analyzing changes
- Show generated commit message
- Show commit being created

## Tools for Creating Assets

### Mac Screen Recording
1. **QuickTime Player**
   - File → New Screen Recording
   - Select portion of screen
   - Record at highest quality

2. **Convert to GIF**
   ```bash
   # Using ffmpeg (install with: brew install ffmpeg)
   ffmpeg -i input.mov -vf "fps=10,scale=720:-1:flags=lanczos" -c:v gif output.gif
   
   # Or use gifski for better quality (brew install gifski)
   gifski --fps 10 --width 720 -o output.gif input.mov
   ```

3. **Optimize video size**
   ```bash
   # Compress MP4
   ffmpeg -i input.mov -vcodec h264 -acodec mp2 -crf 28 output.mp4
   ```

### Alternative: Create with CSS/JS animations
For simple demos, we could create them with CSS animations instead of videos:
- Lighter weight
- Sharper on retina displays
- Easy to customize

## Placeholder Creation

For now, create simple placeholder images:

```bash
# Create placeholder images with ImageMagick
convert -size 1280x720 xc:black -pointsize 48 -fill white \
  -gravity center -annotate +0+0 "Terminal Demo\n(Video Coming Soon)" \
  terminals-placeholder.png

convert -size 1280x720 xc:black -pointsize 48 -fill white \
  -gravity center -annotate +0+0 "Kanban Demo\n(Animation Coming Soon)" \
  kanban-placeholder.png
```