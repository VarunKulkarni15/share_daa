const fs = require('fs');
const data = JSON.parse(fs.readFileSync('figma_output.json'));

let targetFrame = null;
function findFrame(node) {
  if (node.name && node.name.toLowerCase() === 'sharedaa') {
    targetFrame = node;
    return;
  }
  if (node.children) {
    for (let child of node.children) {
      findFrame(child);
      if (targetFrame) return;
    }
  }
}
findFrame(data.document);

if (!targetFrame) {
  console.log('Could not find frame named sharedaa');
} else {
  console.log('Frame found:', targetFrame.name);
  console.log('Width/Height:', targetFrame.absoluteBoundingBox?.width, 'x', targetFrame.absoluteBoundingBox?.height);
  
  function analyzeNode(node, indent = '') {
    console.log(indent + '- Node:', node.name, '(' + node.type + ')');
    
    if (node.absoluteBoundingBox) {
        console.log(indent + '  Bounds:', node.absoluteBoundingBox.width, 'x', node.absoluteBoundingBox.height);
    }
    
    if (node.fills && node.fills.length > 0) {
      console.log(indent + '  Fills:');
      node.fills.forEach(f => {
        if (f.type === 'SOLID') {
          const rgba = `rgba(${Math.round(f.color.r*255)}, ${Math.round(f.color.g*255)}, ${Math.round(f.color.b*255)}, ${f.opacity !== undefined ? f.opacity : f.color.a || 1})`;
          console.log(indent + '    Solid:', rgba);
        } else if (f.type.includes('GRADIENT')) {
          console.log(indent + '    Gradient:', f.type);
          f.gradientStops.forEach(stop => {
              const rgba = `rgba(${Math.round(stop.color.r*255)}, ${Math.round(stop.color.g*255)}, ${Math.round(stop.color.b*255)}, ${stop.color.a})`;
              console.log(indent + '      Stop', stop.position, ':', rgba);
          });
        }
      });
    }

    if (node.strokes && node.strokes.length > 0) {
      console.log(indent + '  Strokes:', node.strokes[0].type);
      if (node.strokes[0].color) {
          console.log(indent + '    Color:', `rgba(${Math.round(node.strokes[0].color.r*255)}, ${Math.round(node.strokes[0].color.g*255)}, ${Math.round(node.strokes[0].color.b*255)}, 1)`);
      }
    }
    
    if (node.effects && node.effects.length > 0) {
      console.log(indent + '  Effects:');
      node.effects.forEach(e => {
          if (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW') {
              console.log(indent + `    ${e.type}: ${e.offset.x}px ${e.offset.y}px, blur: ${e.radius}px`);
              if (e.color) {
                  console.log(indent + '      Color:', `rgba(${Math.round(e.color.r*255)}, ${Math.round(e.color.g*255)}, ${Math.round(e.color.b*255)}, ${e.color.a})`);
              }
          }
      });
    }
    
    if (node.cornerRadius) console.log(indent + '  Border Radius:', node.cornerRadius);
    if (node.style) {
      console.log(indent + '  Text Style:');
      if (node.style.fontFamily) console.log(indent + '    Font:', node.style.fontFamily);
      if (node.style.fontSize) console.log(indent + '    Size:', node.style.fontSize);
      if (node.style.fontWeight) console.log(indent + '    Weight:', node.style.fontWeight);
    }

    if (node.children) {
      node.children.forEach(child => analyzeNode(child, indent + '  '));
    }
  }
  
  if (targetFrame.children) {
    targetFrame.children.forEach(child => analyzeNode(child, '  '));
  }
}
