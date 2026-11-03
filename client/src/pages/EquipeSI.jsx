import { useNavigate } from 'react-router-dom';
import { Etat, useDonnees } from '../App.jsx';
import { fmtPct, fmtPeriode } from '../api.js';
import { Taux } from '../components/Elements.jsx';

export default function EquipeSI() {
  const etat = useDonnees('/equipe-si');
  return <Etat etat={etat}>{(d) => <Contenu d={d} />}</Etat>;
}

const ORIGINE = { affectation: 'affecté', responsable: 'responsable de sites' };

function Contenu({ d }) {
  const navigate = useNavigate();
  const membres = d.membres;
  // Districts distincts pris en charge par l'équipe (un district partagé n'est compté qu'une fois)
  const districts = new Map();
  membres.forEach((m) => m.districts.forEach((x) => districts.set(x.id, x)));
  const dl = [...districts.values()];
  const tot = { sites: dl.reduce((n, x) => n + x.sites, 0), migres: dl.reduce((n, x) => n + x.migres, 0) };
  const vagues = [...new Set(membres.flatMap((m) => m.vagues))].sort((a, b) => a - b);

  return (
    <>
      <section className="panel">
        <h2>Participation de l'équipe Système d'information, par district</h2>
        <p className="sub">
          Chaque membre est responsable de la migration de <b>tous les sites</b> des districts qui lui sont rattachés :
          districts affectés par un administrateur, et districts où il est inscrit comme « Responsable » dans l'extrait.
          L'équipe couvre {dl.length} district{dl.length > 1 ? 's' : ''}, soit {tot.sites} sites dont {tot.migres} migrés ({fmtPct(tot.sites ? (100 * tot.migres) / tot.sites : 0)}).
        </p>
        <div className="team">
          {membres.map((m) => (
            <div key={m.id} className={`membre ${m.districts.length ? '' : 'vide'}`}>
              <div>
                <h3>{m.nom_complet}</h3>
                <div className="sub" style={{ margin: '2px 0 0' }}>
                  {m.districts.length ? `${m.districts.length} district${m.districts.length > 1 ? 's' : ''} · ${m.regions.join(', ')}` : 'Aucun district rattaché : un administrateur peut lui en affecter un.'}
                </div>
              </div>
              <div className="stats">
                <div><b className="num">{m.sites}</b><span>sites à migrer</span></div>
                <div><b className="num" style={{ color: 'var(--good-ink)' }}>{m.migres}</b><span>migrés</span></div>
                <div><b className="num">{m.en_cours}</b><span>en cours</span></div>
                <div><b className="num">{m.non_demarres}</b><span>non démarrés</span></div>
              </div>
              {m.districts.length > 0 && <Taux valeur={m.taux} complet={m.sites > 0 && m.migres === m.sites} gras />}
              {m.nouveaux > 0 && <div className="sub" style={{ margin: 0 }}><span className="badge-nv">Nouveau</span>{m.nouveaux_deployes} / {m.nouveaux} nouveaux sites déployés</div>}
              <div>Vague(s) : {m.vagues.length ? m.vagues.map((v) => <span key={v} className="chip" style={{ marginRight: 4 }}>Vague {v}</span>) : <span className="vide">aucune pour l'instant</span>}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>Districts pris en charge par chaque membre</h2>
        <p className="sub">Tous les sites du district comptent, quel que soit le responsable inscrit pour chaque site. Cliquez un district pour voir ses sites.</p>
        <div className="tablewrap"><table>
          <thead><tr><th>Membre</th><th>District</th><th>Région</th><th>Rattachement</th><th>Vague</th><th>Période de mission</th><th className="r">Sites</th><th className="r">Migrés</th><th>Taux de migration</th><th className="r">En cours</th><th className="r">Non démarrés</th></tr></thead>
          <tbody>
            {membres.flatMap((m) => m.districts.map((x, i) => (
              <tr key={`${m.id}-${x.id}`}>
                <td>{i === 0 ? m.nom_complet : ''}</td>
                <td><button className="lien" type="button" onClick={() => navigate(`/sites?district=${x.id}`)}>{x.nom}</button></td>
                <td>{x.region}</td>
                <td className="sub" style={{ margin: 0 }}>{x.origines.map((o) => ORIGINE[o]).join(', ')}</td>
                <td>{x.vagues_participation.map((v) => <span key={v} className="chip" style={{ marginRight: 4 }}>Vague {v}</span>)}</td>
                <td className="num">{fmtPeriode(x.debut_mission, x.fin_mission)}</td>
                <td className="r num">{x.sites}</td><td className="r num">{x.migres}</td>
                <td><Taux valeur={x.taux} complet={x.complet} /></td>
                <td className="r num">{x.en_cours}</td><td className="r num">{x.non_demarres}</td>
              </tr>
            )))}
          </tbody>
        </table></div>
      </section>

      <section className="panel">
        <h2>Participation par vague</h2>
        <p className="sub">Nombre de sites des districts pris en charge par chaque membre, par vague</p>
        <div className="tablewrap"><table>
          <thead><tr><th>Membre</th>{vagues.map((v) => <th key={v} className="c">Vague {v}</th>)}<th className="r">Districts</th><th className="r">Sites à migrer</th><th className="r">Migrés</th><th>Taux</th></tr></thead>
          <tbody>
            {membres.map((m) => (
              <tr key={m.id}><td>{m.nom_complet}</td>{vagues.map((v) => <td key={v} className="c num">{m.par_vague[v] || '—'}</td>)}
                <td className="r num">{m.districts.length}</td><td className="r num"><b>{m.sites}</b></td><td className="r num">{m.migres}</td><td><Taux valeur={m.taux} /></td></tr>
            ))}
            <tr className="total"><td>Équipe SI (districts distincts)</td>{vagues.map((v) => <td key={v} />)}<td className="r num">{dl.length}</td><td className="r num">{tot.sites}</td><td className="r num">{tot.migres}</td><td>{fmtPct(tot.sites ? (100 * tot.migres) / tot.sites : 0)}</td></tr>
          </tbody>
        </table></div>
      </section>
    </>
  );
}
