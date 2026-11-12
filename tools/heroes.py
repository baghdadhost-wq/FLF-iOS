"""Build original heroes for F.LF by recolouring existing LF2 bodies and remixing their data."""
import colorsys, os, re, sys
from PIL import Image
CONV='/home/claude/conv'
SPR=['/home/claude/ext/LF2_19/sprite','/home/claude/flf-ios/extra/LF2_19/sprite']
OUT=sys.argv[1]
os.makedirs(OUT+'/data',exist_ok=True); os.makedirs(OUT+'/sprite',exist_ok=True)

def find_png(name):
    for d in SPR:
        p=os.path.join(d,name)
        if os.path.exists(p): return p
    raise FileNotFoundError(name)

def is_skin(h,s,v): return (h<0.12 or h>0.97) and 0.12<s<0.65 and v>0.45
def recolor(src,dst,fn):
    im=Image.open(find_png(src))
    if im.mode!='P':
        im=im.convert('RGBA'); px=im.load()
        cache={}
        for y in range(im.size[1]):
            for x in range(im.size[0]):
                r,g,b,a=px[x,y]
                if a==0 or (r,g,b)==(0,0,0): continue
                k=(r,g,b)
                if k not in cache:
                    h,s_,v=colorsys.rgb_to_hsv(r/255,g/255,b/255); h,s_,v=fn(h,s_,v)
                    cache[k]=tuple(int(max(0,min(1,c))*255) for c in colorsys.hsv_to_rgb(h%1,s_,v))
                px[x,y]=cache[k]+(a,)
        im.save(os.path.join(OUT,'sprite',dst),optimize=True); return
    pal=im.getpalette(); tr=im.info.get('transparency')
    new=[]
    for i in range(len(pal)//3):
        r,g,b=[x/255 for x in pal[i*3:i*3+3]]
        if (r,g,b)==(0,0,0) or i==tr: new+=pal[i*3:i*3+3]; continue
        h,s,v=colorsys.rgb_to_hsv(r,g,b)
        h,s,v=fn(h,s,v)
        new+=[int(max(0,min(1,x))*255) for x in colorsys.hsv_to_rgb(h%1,s,v)]
    im.putpalette(new)
    kw={'optimize':True}
    if tr is not None: kw['transparency']=tr
    im.save(os.path.join(OUT,'sprite',dst),**kw)

def tint(hue,sat_mul=1.0,val_mul=1.0,keep_skin=True,min_sat=0.25):
    def f(h,s,v):
        if keep_skin and is_skin(h,s,v): return h,s,v
        if s<0.08: return h,s,v*val_mul          # greys / whites keep their tone
        return hue,max(min_sat,min(1,s*sat_mul)),min(1,v*val_mul)
    return f
def stone(h,s,v):
    return 0.08,0.12,min(1,0.25+v*0.75)
def electric(h,s,v):
    return 0.14,min(1,0.35+s*0.8),min(1,0.35+v*0.85)

HEROES=[
 dict(id=60,key='storm',name='Storm Warden',base='freeze',fn=tint(0.13,1.1,1.05),
      walk=1.15,
      specials={209:(230,'storm_ball','freeze_ball',electric,{'freeze_ball.png':'storm_ball.png'}),
                212:(231,'storm_column','freeze_column',electric,{'freeze_col.png':'storm_col.png','freeze_ww.png':'storm_ww.png'})}),
 dict(id=61,key='engineer',name='Engineer',base='woody',fn=tint(0.5,1.2,1.05),walk=1.0,
      specials={206:(232,'engineer_ball','woody_ball',tint(0.5,1.3,1.1,False),{'woody_ball.png':'engineer_ball.png'})}),
 dict(id=62,key='nightfox',name='Night Fox',base='rudolf',fn=tint(0.78,1.1,0.95),walk=1.2,
      specials={202:(233,'nightfox_star','rudolf_weapon',tint(0.86,1.3,1.1,False),{'rudolf_weapon.png':'nightfox_star.png'})}),
 dict(id=63,key='stonegiant',name='Stone Giant',base='mark',fn=stone,walk=0.85,specials={}),
]

entries=[]; specials_entries=[]
for H in HEROES:
    js=open(os.path.join(CONV,H['base']+'.js'),encoding='latin1').read()
    # sprites of the body
    for m in sorted(set(re.findall(r'sprite/([A-Za-z0-9_]+)\.png',js))):
        newname=m.replace(H['base'],H['key'],1) if m.startswith(H['base']) else H['key']+'_'+m
        recolor(m+'.png',newname+'.png',H['fn'])
        js=js.replace('sprite/%s.png'%m,'sprite/%s.png'%newname)
    js=re.sub(r'name: "[^"]*"','name: "%s"'%H['name'],js,count=1)
    # movement feel
    def scale(mm):
        return '%s: %s'%(mm.group(1), round(float(mm.group(2))*H['walk'],4))
    js=re.sub(r'(walking_speed|running_speed|walking_speedz|running_speedz): (-?[0-9.]+)',scale,js)
    # remixed projectiles
    for old,(nid,fname,basefile,pfn,sprmap) in H['specials'].items():
        js=re.sub(r'oid: %d\b'%old,'oid: %d'%nid,js)
        pj=open(os.path.join(CONV,basefile+'.js'),encoding='latin1').read()
        for a,b in sprmap.items():
            recolor(a,b,pfn); pj=pj.replace('sprite/'+a,'sprite/'+b)
        for o2,(n2,*_) in H['specials'].items():
            pj=re.sub(r'oid: %d\b'%o2,'oid: %d'%n2,pj)
        open(os.path.join(OUT,'data',fname+'.js'),'w',encoding='latin1').write(pj)
        specials_entries.append("		{id:%d, type:'specialattack', file:'data/%s.js'}"%(nid,fname))
    open(os.path.join(OUT,'data',H['key']+'.js'),'w',encoding='latin1').write(js)
    pack=[n for (n,*_) in H['specials'].values()]
    packs=', pack:[%s]'%','.join('{id:%d}'%p for p in pack) if pack else ''
    entries.append("		{id:%d, name:'%s', type:'character', file:'data/%s.js', pic:'sprite/%s_f.png'%s},"%(H['id'],H['name'],H['key'],H['key'],packs))
open(os.path.join(OUT,'entries.txt'),'w').write('\n'.join(entries)+'\n##\n'+',\n'.join(specials_entries))
print('\n'.join(entries)); print(',\n'.join(specials_entries))
