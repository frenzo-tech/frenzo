/**
 * BNB 标志生成器（纯 three.js 程序化几何）
 *   胸章：中央菱形 + 上下左右四颗小菱形
 *   眼镜：一对单菱形镜片 + 鼻梁
 */
(function () {
  var THREE = null;
  var GOLD = 0xf3ba2f;

  function diamondShape(r) {
    var s = new THREE.Shape();
    s.moveTo(0, r);
    s.lineTo(r, 0);
    s.lineTo(0, -r);
    s.lineTo(-r, 0);
    s.lineTo(0, r);
    return s;
  }

  function geoOf(size) {
    var g = new THREE.ExtrudeGeometry(diamondShape(size), {
      depth: size * 0.38,
      bevelEnabled: true,
      bevelSize: size * 0.09,
      bevelThickness: size * 0.09,
      bevelSegments: 2,
      curveSegments: 2,
    });
    g.center();
    return g;
  }

  function matOf(color, glow) {
    return new THREE.MeshStandardMaterial({
      color: color,
      metalness: 0.92,
      roughness: 0.24,
      emissive: color,
      emissiveIntensity: glow === undefined ? 0.5 : glow,
    });
  }

  function single(size, color, glow) {
    return new THREE.Mesh(geoOf(size), matOf(color === undefined ? GOLD : color, glow));
  }

  function cluster(size, color, glow) {
    var g = new THREE.Group();
    var geo = geoOf(size);
    var mat = matOf(color === undefined ? GOLD : color, glow);
    g.add(new THREE.Mesh(geo, mat));
    var off = size * 1.45;
    [[0, off], [off, 0], [0, -off], [-off, 0]].forEach(function (p) {
      var m = new THREE.Mesh(geo, mat);
      m.position.set(p[0], p[1], 0);
      m.scale.setScalar(0.52);
      g.add(m);
    });
    return g;
  }

  window.FRENZO_BNB = {
    init: function (three) { THREE = three; },

    // 胸口徽章
    chest: function (h, front) {
      var e = cluster(h * 0.028);
      e.position.set(0, h * 0.615, front * 0.128);
      e.rotation.x = -0.12;
      return e;
    },

    // 眼镜：一对菱形镜片贴在护目镜位置
    glasses: function (h, front) {
      var g = new THREE.Group();
      var lens = geoOf(h * 0.028);
      var mat = matOf(GOLD, 0.85);

      [-1, 1].forEach(function (sx) {
        var m = new THREE.Mesh(lens, mat);
        m.position.set(sx * h * 0.046, h * 0.770, front * 0.118);
        m.scale.set(1.05, 0.72, 1);
        g.add(m);

        // 内芯：更深一点的核心
        var core = new THREE.Mesh(geoOf(h * 0.011), matOf(0xffd968, 1.2));
        core.position.set(sx * h * 0.046, h * 0.770, front * 0.128);
        core.scale.set(1, 1, 1);
        g.add(core);
      });

      // 鼻梁
      var bar = new THREE.Mesh(
        new THREE.BoxGeometry(h * 0.028, h * 0.007, h * 0.007),
        new THREE.MeshStandardMaterial({ color: 0x1a1f28, metalness: 0.9, roughness: 0.3 })
      );
      bar.position.set(0, h * 0.770, front * 0.118);
      g.add(bar);

      // 镜腿（向两侧延伸）
      [-1, 1].forEach(function (sx) {
        var arm = new THREE.Mesh(
          new THREE.BoxGeometry(h * 0.055, h * 0.008, h * 0.010),
          new THREE.MeshStandardMaterial({ color: 0x1a1f28, metalness: 0.9, roughness: 0.3 })
        );
        arm.position.set(sx * h * 0.098, h * 0.770, front * 0.06);
        arm.rotation.y = sx * 0.5;
        g.add(arm);
      });

      return g;
    },

    chestColor: function (h, front, color) {
      var e = cluster(h * 0.028, color);
      e.position.set(0, h * 0.615, front * 0.128);
      e.rotation.x = -0.12;
      return e;
    },

    single: single,
    cluster: cluster,
  };
})();
