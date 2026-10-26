// Cherry BiM: выгрузка моделей БАЗИС-Мебельщика в JSON — панели с контурами, профили, фурнитура, блоки.
//
// Запуск — меню «Скрипты» БАЗИС-Мебельщика (скрипт лежит в Документы\BazisNN\Scripts\). Рядом со скриптом —
// cherrybim-export.json: {"files": ["C:/…/шкаф.b3d", …], "out": "C:/…/папка"}. Каждый файл загружается в свой блок
// модели и выгружается в <out>/<имя файла>.json. Без списка выгружается текущая модель с запросом имени файла.
//
// Единицы — мм, глобальная система модели. У панели: материал, толщина, контур в её системе (линии, дуги,
// окружности), начало системы o и оси ex, ey, ez в глобальной; габарит min/max. Читает это cherrybim.io_bazis.
// Файл скрипта — в cp1251: так БАЗИС читает русские строки (в репозитории — UTF-8, перекодирует tools/bazis/deploy).

var R = function (v) { return Math.round(v * 100) / 100; };
function vec(p) { return [R(p.x), R(p.y), R(p.z)]; }
function pt(p) { return [R(p.x), R(p.y)]; }
function safe(f) { try { return f(); } catch (e) { return undefined; } }

function contour(c) {
  var out = [], n = c ? safe(function () { return c.Count; }) || 0 : 0;
  for (var i = 0; i < n; i++) {
    var el = safe(function () { return c.Objects[i]; }) || safe(function () { return c[i]; });
    if (!el) continue;
    if (el.IsLine()) { var l = el.AsLine(); out.push({ l: [pt(l.Pos1), pt(l.Pos2)] }); }
    else if (el.IsArc()) { var a = el.AsArc(); out.push({ a: [pt(a.Pos1), pt(a.Pos2)], c: pt(a.Center), ccw: !!a.ArcDir }); }
    else if (el.IsCircle()) { var ci = el.AsCircle(); out.push({ o: pt(ci.Center), r: R(ci.CirRadius) }); }
    else if (el.IsList()) out.push({ list: contour(el.AsList()) });
    else out.push({ t: String(safe(function () { return el.ElType; })) });
  }
  return out;
}

function frame(o, r) {                    // система объекта в глобальной: начало и оси
  r.o = vec(o.ToGlobal(NewVector(0, 0, 0)));
  r.ex = vec(o.NToGlobal(NewVector(1, 0, 0)));
  r.ey = vec(o.NToGlobal(NewVector(0, 1, 0)));
  r.ez = vec(o.NToGlobal(NewVector(0, 0, 1)));
}

function child(o, i) { return safe(function () { return o.Objects[i]; }) || safe(function () { return o[i]; }); }

function obj(o) {
  var r = { n: String(safe(function () { return o.Name; }) || '') };
  var art = safe(function () { return o.ArtPos; });
  if (art) r.art = String(art);
  r.min = vec(o.GabMin);
  r.max = vec(o.GabMax);
  if (safe(function () { return o.Visible; }) === false) r.hidden = true;
  var up = safe(function () { return o.UserPropCount; }) || 0;
  if (up) {
    r.user = {};
    for (var u = 0; u < up; u++) {
      var un = safe(function () { return o.UserPropertyName[u]; }) || safe(function () { return o.UserPropertyName(u); }) || String(u);
      r.user[String(un)] = String(safe(function () { return o.UserProperty[u]; }) || safe(function () { return o.UserProperty(u); }));
    }
  }
  var p = safe(function () { return o.AsPanel; });
  if (p) {
    r.t = 'panel';
    r.th = R(p.Thickness);
    r.mat = String(p.MaterialName || '');
    frame(o, r);
    r.c = contour(p.Contour);
    var nc = safe(function () { return p.Cuts.Count; }) || 0;
    if (nc) {
      r.cuts = [];
      for (var k = 0; k < nc; k++) {
        var cut = safe(function () { return p.Cuts.Cuts[k]; }) || safe(function () { return p.Cuts[k]; });
        if (cut) r.cuts.push({ n: String(cut.Name || ''), path: contour(safe(function () { return cut.Trajectory; })),
          profile: contour(safe(function () { return cut.Contour; })) });
      }
    }
    var nb = safe(function () { return p.Butts.Count; }) || 0;
    if (nb) r.butts = nb;
    return r;
  }
  if (safe(function () { return o.List; })) {
    r.t = 'list';
    var anim = safe(function () { return o.AnimType; });
    if (anim !== undefined && anim !== null) r.anim = String(anim);
    if (safe(function () { return o.IsFastener; }) === true) r.fastener = true;   // не булево — значит, не задано
    var ft = safe(function () { return o.FurnType; });
    if (ft) r.furn = String(ft);
    frame(o, r);
    var n = safe(function () { return o.Count; }) || 0;
    r.count = n;
    if (!r.fastener) {                    // составная фурнитура (петля, ручка) — габаритом, без сетки внутри
      r.kids = [];
      for (var i = 0; i < n; i++) { var ch = child(o, i); if (ch) r.kids.push(obj(ch)); }
    }
    return r;
  }
  var tr = safe(function () { return o.Trajectory2D; });
  var c2 = safe(function () { return o.Contour2D; });
  var ct = safe(function () { return o.Contour; });
  var th = safe(function () { return o.Thickness; });
  if (tr) { r.t = 'trajectory'; r.c = contour(c2); r.path = contour(tr); }
  else if (ct && th !== undefined) { r.t = 'extrusion'; r.th = R(th); r.c = contour(ct); }
  else r.t = 'other';
  var mn = safe(function () { return o.MaterialName; });
  if (mn) r.mat = String(mn);
  frame(o, r);
  return r;
}

var cfg = system.fileExists('cherrybim-export.json') ? JSON.parse(system.readTextFile('cherrybim-export.json')) : null;
if (cfg) {
  var done = [];
  for (var f = 0; f < cfg.files.length; f++) {
    var file = cfg.files[f], name = system.getFileNameWithoutExtension(file);
    var blk = AddBlock(name);
    blk.Load(file);
    var doc = { file: file, api: system.apiVersion, units: 'mm', root: obj(blk) };
    system.writeTextFile(cfg.out + '/' + name + '.json', JSON.stringify(doc));
    done.push(name + ' (' + blk.Count + ')');
  }
  alert('Cherry BiM: выгружено ' + done.length + ' — ' + done.join(', '));
} else {
  system.askWriteTextFile('json', JSON.stringify({ api: system.apiVersion, units: 'mm', root: obj(Model) }));
}
