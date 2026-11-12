"""Rebuild Storm Warden's sprite sheets from the Gemini-drawn sheet."""
import re, json, collections
import numpy as np
from PIL import Image
G='/home/claude/gem/'
OUT='/home/claude/flf-ios/extra/LF2_19/sprite/'
src=Image.open(G+'sheet.jpg').convert('RGB'); A=np.asarray(src).astype(int)
rows=json.load(open(G+'rows.json'))
def S(r,c): return rows[r][c]
POOLS={
 'stand':[S(0,i) for i in range(12)],
 'walk':[S(1,i) for i in range(6)],
 'run':[S(1,i) for i in range(6,12)],
 'punch':[S(2,i) for i in range(9)],
 'power':[S(2,9),S(2,10),S(3,4)],
 'cast':[S(3,i) for i in range(4)]+[S(2,9),S(2,10)],
 'carry':[S(3,i) for i in range(5,11)],
 'hurt':[S(4,i) for i in range(4)],
 'fall':[S(4,i) for i in range(4,8)],
 'lying':[S(4,8),S(4,9)],
 'kneel':[S(4,10),S(4,11),S(5,8),S(5,9),S(5,10)],
 'guard':[S(5,1)],
 'hitpunch':[S(5,0),S(5,2)],
 'crouch':[S(5,3),S(5,4),S(6,0)],
 'roll':[S(5,6),S(5,7)],
 'jump':[S(6,1),S(6,2),S(6,3),S(6,4)],
 'kick':[S(6,7),S(6,8)],
}
def classify(names):
    n=' '.join(names).lower()
    for key,pool in [('lying','lying'),('falling','fall'),('injured','hurt'),('broken_defend','hurt'),('ice','hurt'),('fire','hurt'),
                     ('picked_caught','hurt'),('crouch','kneel'),('rowing','roll'),('defend','guard'),('heavy_obj','carry'),('heavy_stop','carry'),
                     ('heavy_weapon_thw','carry'),('super_punch','power'),('dash_attack','kick'),('jump_attack','kick'),('dash','jump'),('jump','jump'),
                     ('stop_running','kneel'),('running','run'),('walking','walk'),('standing','stand'),('catching','hitpunch'),
                     ('whirlwind','cast'),('sword','cast'),('ball','cast'),('down_punch','power'),('weapon','punch'),('thw','punch'),
                     ('drink','stand'),('picking','kneel'),('punch','punch'),('run_attack','punch')]:
        if key in n: return pool
    return 'stand'

# scale: standing height -> 62 px
stand_h=np.median([b[1]-b[0] for b in POOLS['stand']])
SC=62/stand_h
cache={}
def sprite(b):
    k=tuple(b)
    if k in cache: return cache[k]
    y0,y1,x0,x1=b
    crop=A[y0:y1,x0:x1]
    alpha=(crop.max(axis=2)>45).astype(np.uint8)*255
    rgba=np.dstack([np.clip(crop,10,255),alpha]).astype(np.uint8)
    im=Image.fromarray(rgba,'RGBA')
    w=max(1,round(im.width*SC)); h=max(1,round(im.height*SC))
    im=im.resize((w,h),Image.LANCZOS)
    a=np.asarray(im).copy(); a[...,3]=np.where(a[...,3]>110,255,0)
    im=Image.fromarray(a,'RGBA')
    # feet centre: centre of opaque pixels in the bottom 25%
    m=a[...,3]>0; rows_=np.where(m.any(axis=1))[0]
    bot=rows_.max(); band=m[max(0,bot-int(h*0.25)):bot+1]
    xs=np.where(band.any(axis=0))[0]; fx=(xs.min()+xs.max())/2 if len(xs) else w/2
    cache[k]=(im,fx,bot)
    return cache[k]

def build(datafile, prefix, nsheets):
    s=open(datafile,encoding='latin1').read()
    pics=collections.defaultdict(list); center={}
    for m in re.finditer(r'(\d+): \{ name: "([^"]*)",\s*pic: (\d+),[^}]*?centerx: (-?\d+), centery: (-?\d+)',s):
        n,p,cx,cy=m.group(2),int(m.group(3)),int(m.group(4)),int(m.group(5))
        pics[p].append(n); center.setdefault(p,(cx,cy))
    counters=collections.Counter()
    sheets=[Image.new('RGBA',(800,560),(0,0,0,0)) for _ in range(nsheets)]
    for p in sorted(pics):
        pool=classify(pics[p]); lst=POOLS[pool]
        b=lst[counters[pool]%len(lst)]; counters[pool]+=1
        im,fx,bot=sprite(b)
        cx,cy=center[p]
        sh=p//70; q=p%70; col=q%10; row=q//10
        if sh>=nsheets: continue
        ox=col*80; oy=row*80
        cell=Image.new('RGBA',(79,79),(0,0,0,0))
        cell.alpha_composite(im,(int(round(cx-fx)) if im.width<=79 else 0, int(cy-bot-1)) if False else (0,0)) if False else None
        px=int(round(cx-fx)); py=int(cy-bot-1)
        tmp=Image.new('RGBA',(79,79),(0,0,0,0))
        # paste with clipping
        tmp.paste(im,(px,py),im)
        sheets[sh].alpha_composite(tmp,(ox,oy))
    for i,sh in enumerate(sheets):
        # to indexed png with black (index 255) as transparent, like F.LF sprites
        a=np.asarray(sh); opaque=a[...,3]>0
        rgb=Image.fromarray(a[...,:3]).convert('RGB')
        q=rgb.quantize(colors=255,method=Image.MEDIANCUT)
        idx=np.asarray(q).copy(); idx[~opaque]=255
        pal=q.getpalette()[:255*3]+[0,0,0]
        out=Image.fromarray(idx.astype(np.uint8),'P'); out.putpalette(pal)
        out.save(OUT+'%s_%d.png'%(prefix,i),transparency=255,optimize=True)
    print('built',prefix,dict(counters))

build('/home/claude/flf-ios/extra/LF2_19/data/storm.js','storm',3)

# portrait 120x120 + small 40x45 from the face image
f=Image.open(G+'face2.jpg').convert('RGB')
W,H=f.size
face=f.crop((int(W*0.22),int(H*0.05),int(W*0.82),int(H*0.65))).resize((120,120),Image.LANCZOS)
face.quantize(255).save(OUT+'storm_f.png',optimize=True)
small=f.crop((int(W*0.35),int(H*0.08),int(W*0.75),int(H*0.55))).resize((40,45),Image.LANCZOS)
small.quantize(255).save(OUT+'storm_s.png',optimize=True)
print('faces ok')
