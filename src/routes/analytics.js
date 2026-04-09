export async function analyticsRoutes(app) {
  app.get('/v1/analytics/franqueado/resumo', {
    preHandler: [
      app.authenticate,
      app.requirePapel(['franqueador_master', 'franqueado']),
    ],
  }, async (request) => {
    const { tenant_id } = request.user
    const db = await app.dbTenant(tenant_id)

    try {
      const resumoHojeQ = await db.query(`
        WITH lives_ao_vivo AS (
          SELECT c.live_atual_id AS live_id
          FROM cabines c
          WHERE c.status = 'ao_vivo'
            AND c.live_atual_id IS NOT NULL
        ), snapshots_recentes AS (
          SELECT DISTINCT ON (ls.live_id)
                 ls.live_id,
                 ls.viewer_count,
                 ls.gmv
          FROM live_snapshots ls
          JOIN lives_ao_vivo laov ON laov.live_id = ls.live_id
          ORDER BY ls.live_id, ls.captured_at DESC
        )
        SELECT
          COALESCE(SUM(sr.gmv), 0) AS gmv_total_hoje,
          COALESCE(SUM(sr.viewer_count), 0) AS audiencia_total_ao_vivo,
          (
            SELECT COUNT(*)
            FROM lives l
            WHERE l.status = 'encerrada'
              AND date_trunc('day', l.iniciado_em) = date_trunc('day', NOW())
          ) AS total_lives_hoje
        FROM snapshots_recentes sr
      `)

      const rankingClosersQ = await db.query(`
        SELECT
          u.id AS apresentador_id,
          u.nome AS apresentador_nome,
          COUNT(l.id) AS total_lives,
          COALESCE(SUM(l.fat_gerado), 0) AS gmv_total
        FROM lives l
        JOIN users u ON u.id = l.apresentador_id
        WHERE l.status = 'encerrada'
        GROUP BY u.id, u.nome
        ORDER BY gmv_total DESC, total_lives DESC, apresentador_nome ASC
        LIMIT 5
      `)

      const rankingClientesQ = await db.query(`
        SELECT
          c.id AS cliente_id,
          c.nome AS cliente_nome,
          COALESCE(SUM(l.fat_gerado), 0) AS gmv_total,
          MAX(l.iniciado_em) AS ultima_live
        FROM lives l
        JOIN clientes c ON c.id = l.cliente_id
        WHERE l.status = 'encerrada'
        GROUP BY c.id, c.nome
        ORDER BY gmv_total DESC, ultima_live DESC NULLS LAST, cliente_nome ASC
        LIMIT 5
      `)

      const heatmapHorariosQ = await db.query(`
        SELECT
          EXTRACT(HOUR FROM l.iniciado_em)::int AS hora,
          COUNT(*) AS total_lives,
          COALESCE(SUM(l.fat_gerado), 0) AS gmv_total
        FROM lives l
        WHERE l.status = 'encerrada'
        GROUP BY hora
        ORDER BY hora ASC
      `)

      const eficienciaCabinesQ = await db.query(`
        SELECT
          c.id AS cabine_id,
          CONCAT('Cabine ', LPAD(c.numero::text, 2, '0')) AS cabine_nome,
          COUNT(l.id) AS total_lives,
          COALESCE(SUM(l.fat_gerado), 0) AS gmv_acumulado
        FROM cabines c
        LEFT JOIN lives l
          ON l.cabine_id = c.id
         AND l.status = 'encerrada'
        GROUP BY c.id, c.numero
        ORDER BY gmv_acumulado DESC, total_lives DESC, c.numero ASC
        LIMIT 5
      `)

      const resumoHoje = resumoHojeQ.rows[0] ?? {}

      return {
        resumo_hoje: {
          gmv_total_hoje: parseFloat(Number(resumoHoje.gmv_total_hoje ?? 0).toFixed(2)),
          audiencia_total_ao_vivo: Number(resumoHoje.audiencia_total_ao_vivo ?? 0),
          total_lives_hoje: Number(resumoHoje.total_lives_hoje ?? 0),
        },
        ranking_closers: rankingClosersQ.rows.map((row) => ({
          apresentador_id: row.apresentador_id,
          apresentador_nome: row.apresentador_nome,
          total_lives: Number(row.total_lives),
          gmv_total: parseFloat(Number(row.gmv_total).toFixed(2)),
        })),
        ranking_clientes: rankingClientesQ.rows.map((row) => ({
          cliente_id: row.cliente_id,
          cliente_nome: row.cliente_nome,
          gmv_total: parseFloat(Number(row.gmv_total).toFixed(2)),
          ultima_live: row.ultima_live,
        })),
        heatmap_horarios: heatmapHorariosQ.rows.map((row) => ({
          hora: Number(row.hora),
          total_lives: Number(row.total_lives),
          gmv_total: parseFloat(Number(row.gmv_total).toFixed(2)),
        })),
        eficiencia_cabines: eficienciaCabinesQ.rows.map((row) => ({
          cabine_id: row.cabine_id,
          cabine_nome: row.cabine_nome,
          total_lives: Number(row.total_lives),
          gmv_acumulado: parseFloat(Number(row.gmv_acumulado).toFixed(2)),
        })),
      }
    } finally {
      db.release()
    }
  })
}
