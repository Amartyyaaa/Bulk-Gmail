import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { EmptyState } from '../components/ui.jsx';

export default function NotFound() {
  return (
    <EmptyState icon={Compass} title="Page not found" action={<Link className="btn btn-primary" to="/campaigns">Go to campaigns</Link>}>
      The page you were looking for doesn’t exist.
    </EmptyState>
  );
}
